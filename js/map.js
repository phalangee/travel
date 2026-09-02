/* 地图模块：高德 JS API 1.4.15 动态渲染（DOM 渲染，无 WebGL，iOS 低内存）
 * 防崩溃策略：
 *   1. 懒挂载：卡片进入视口才创建地图（IntersectionObserver）
 *   2. 离屏销毁：滑走的卡片立即 destroy，全程最多 1-2 个存活实例
 *   3. 失败降级：加载失败时显示有序地点条，仍可跳转高德 */
'use strict';

const PLACE_TYPE = {
  lodging: { label: '住宿', color: '#2563eb' },
  scenic: { label: '景点', color: '#f59e0b' },
  food: { label: '餐购', color: '#ef4444' },
  transfer: { label: '换乘', color: '#6b7280' }
};

/* ---------- 高德 JS API 懒加载（单例，1.4.15 DOM 渲染版） ---------- */
var amapPromise = null;

function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;

  amapPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    // 1.4.x 携带安全密钥的方式：URL 追加 jscode 参数
    s.src = 'https://webapi.amap.com/maps?v=1.4.15&key=' +
      encodeURIComponent(CONFIG.amapKey) +
      (CONFIG.securityJsCode ? '&jscode=' + encodeURIComponent(CONFIG.securityJsCode) : '');
    s.onload = function () {
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        amapPromise = null;
        reject(new Error('高德 JS API 加载异常'));
      }
    };
    s.onerror = function () {
      amapPromise = null;
      reject(new Error('高德 JS API 网络加载失败'));
    };
    document.head.appendChild(s);
  });
  return amapPromise;
}

/* ---------- IntersectionObserver 共享实例：进入视口挂载，离开视口销毁 ---------- */
var mapObserver = null;

function getObserver() {
  if (mapObserver) return mapObserver;
  mapObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var rec = entry.target.__mapRec;
      if (!rec) return;
      if (entry.isIntersecting) {
        rec.visible = true;
        mountMap(entry.target);
      } else {
        rec.visible = false;
        unmountMap(entry.target);
      }
    });
  }, { rootMargin: '60px 0px 60px 0px', threshold: 0 });
  return mapObserver;
}

/* ---------- 挂载 / 卸载 ---------- */
function mountMap(container) {
  var rec = container.__mapRec;
  if (!rec || rec.failed || container.__map) return;

  loadAMap().then(function (AMap) {
    // 异步期间卡片可能已滑出视口，或已被其他逻辑挂载
    if (!rec.visible || container.__map) return;

    var map = new AMap.Map(container, {
      zoom: 10,
      center: rec.places[0].location,
      resizeEnable: true
    });

    var overlays = [];
    rec.places.forEach(function (p, i) {
      overlays.push(new AMap.Marker({
        position: p.location,
        content: '<div class="amap-pin pin--' + (p.type || 'scenic') + '">' + (i + 1) + '</div>',
        offset: new AMap.Pixel(-12, -12), // 24x24 图标居中于坐标点
        title: p.name
      }));
    });
    if (rec.places.length > 1) {
      overlays.push(new AMap.Polyline({
        path: rec.places.map(function (p) { return p.location; }),
        strokeColor: '#2563eb',
        strokeWeight: 3,
        strokeOpacity: 0.85,
        showDir: true
      }));
    }
    map.add(overlays);
    map.setFitView(overlays, false, [40, 40, 40, 40]);
    container.__map = map;
  }).catch(function (err) {
    console.warn('地图加载失败，降级为地点条:', err);
    rec.failed = true;
    renderFallback(container, rec.places, rec.note);
  });
}

function unmountMap(container) {
  if (container.__map) {
    try { container.__map.destroy(); } catch (e) { /* 忽略销毁异常 */ }
    container.__map = null;
    container.textContent = '';
  }
}

/* ---------- 降级渲染：有序地点条 ---------- */
function renderFallback(container, places, note) {
  container.textContent = '';
  container.classList.add('map-fallback');
  if (note) container.appendChild(el('p', 'map-fallback__note', note));
  var list = el('ol', 'map-fallback__list');
  (places || []).forEach(function (p, i) {
    var li = el('li', 'map-fallback__item');
    var badge = el('span', 'pin pin--' + (p.type || 'scenic'), String(i + 1));
    var name = el('span', 'map-fallback__name', p.name);
    li.appendChild(badge);
    li.appendChild(name);
    if (p.location) {
      var a = el('a', 'map-fallback__link', '高德打开 ↗');
      a.href = amapMarkerUri(p.location[0], p.location[1], p.name);
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
    }
    list.appendChild(li);
  });
  container.appendChild(list);
}

/* ---------- 统一入口：注册懒挂载 ---------- */
function initPlaceMap(container, places, note) {
  if (!container) return;

  var pts = (places || []).filter(function (p) { return p.location; });
  if (!pts.length) {
    renderFallback(container, places || [], note);
    return;
  }

  container.__mapRec = { places: pts, note: note || '', visible: false, failed: false };
  unmountMap(container); // 清理可能存在的旧实例

  if ('IntersectionObserver' in window) {
    getObserver().observe(container);
  } else {
    // 老浏览器降级：直接挂载
    container.__mapRec.visible = true;
    mountMap(container);
  }
}

/* 主页足迹图（兼容旧接口） */
function renderFootprintMap(container, spots) {
  initPlaceMap(container, spots, null);
}
