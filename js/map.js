/* 地图模块：有高德 Key 时渲染真实地图；无 Key 或加载失败时降级为有序地点条 */
'use strict';

const PLACE_TYPE = {
  lodging: { label: '住宿', color: '#2563eb' },
  scenic: { label: '景点', color: '#f59e0b' },
  food: { label: '餐购', color: '#ef4444' },
  transfer: { label: '换乘', color: '#6b7280' }
};

let amapReady = null; // Promise<AMap>

function amapLoader() {
  if (amapReady) return amapReady;
  if (!CONFIG.amapKey) {
    amapReady = Promise.reject(new Error('no-key'));
    return amapReady;
  }
  // 高德 2.0 推荐用 Loader 加载，并在加载前设置安全密钥
  amapReady = new Promise(function (resolve, reject) {
    // 1. 先设置安全密钥（必须在 loader 之前）
    if (CONFIG.securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode: CONFIG.securityJsCode };
    }
    // 2. 加载 loader.js
    const loader = document.createElement('script');
    loader.src = 'https://webapi.amap.com/loader.js';
    loader.onload = function () {
      if (!window.AMapLoader) {
        reject(new Error('AMapLoader 未定义'));
        return;
      }
      // 3. 通过 Loader 加载地图核心
      window.AMapLoader.load({
        key: CONFIG.amapKey,
        version: '2.0'
      }).then(function (AMap) {
        resolve(AMap);
      }).catch(function (err) {
        reject(new Error('高德地图加载失败: ' + (err && err.message ? err.message : '未知错误')));
      });
    };
    loader.onerror = function () { reject(new Error('高德 Loader 加载失败')); };
    document.head.appendChild(loader);
  });
  amapReady.catch(function () {}); // 防止未处理 rejection
  return amapReady;
}

/* ---------- 降级渲染：有序地点条 ---------- */

function renderFallback(container, places, note) {
  container.textContent = '';
  container.classList.add('map-fallback');
  if (note) container.appendChild(el('p', 'map-fallback__note', note));
  const list = el('ol', 'map-fallback__list');
  (places || []).forEach(function (p, i) {
    const li = el('li', 'map-fallback__item');
    const badge = el('span', 'pin pin--' + (p.type || 'scenic'), String(i + 1));
    const name = el('span', 'map-fallback__name', p.name);
    li.appendChild(badge);
    li.appendChild(name);
    if (p.location) {
      const a = el('a', 'map-fallback__link', '高德打开 ↗');
      a.href = amapMarkerUri(p.location[0], p.location[1], p.name);
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
    }
    list.appendChild(li);
  });
  container.appendChild(list);
}

/* ---------- 真实地图 ---------- */

function markerContent(idx, type) {
  const color = (PLACE_TYPE[type] || PLACE_TYPE.scenic).color;
  return '<div class="amap-pin" style="background:' + color + '">' + idx + '</div>';
}

function infoWindowHTML(p) {
  const type = PLACE_TYPE[p.type] || PLACE_TYPE.scenic;
  let html = '<div class="amap-iw"><div class="amap-iw__name">' + escapeHTML(p.name) + '</div>';
  html += '<div class="amap-iw__tag" style="color:' + type.color + '">' + type.label + (p.note ? ' · ' + escapeHTML(p.note) : '') + '</div>';
  if (p.address) html += '<div class="amap-iw__addr">' + escapeHTML(p.address) + '</div>';
  if (p.location) {
    html += '<a class="amap-iw__btn" href="' + amapNavUri(p.location[0], p.location[1], p.name) + '" target="_blank" rel="noopener">在高德中导航</a>';
  }
  html += '</div>';
  return html;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 通用：在 container 中画一组地点 + 顺序连线 */
function drawPlacesMap(container, places) {
  return amapLoader().then(function (AMap) {
    container.textContent = '';
    container.classList.add('amap-container');
    const pts = (places || []).filter(function (p) { return p.location; });
    if (!pts.length) throw new Error('no-places');
    const map = new AMap.Map(container, {
      zoom: 7,
      center: pts[0].location,
      viewMode: '2D',
      resizeEnable: true
    });
    if (pts.length > 1) {
      map.add(new AMap.Polyline({
        path: pts.map(function (p) { return p.location; }),
        strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.8,
        showDir: true, lineJoin: 'round'
      }));
    }
    const info = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -32) });
    pts.forEach(function (p, i) {
      const marker = new AMap.Marker({
        position: p.location,
        content: markerContent(i + 1, p.type),
        anchor: 'center',
        title: p.name
      });
      marker.on('click', function () {
        info.setContent(infoWindowHTML(p));
        info.open(map, p.location);
      });
      map.add(marker);
    });
    map.setFitView(null, false, [48, 48, 48, 48]);
    return map;
  });
}

/* 日卡小地图 / 足迹图 / 全程图 统一入口：失败自动降级 */
function initPlaceMap(container, places, note) {
  return drawPlacesMap(container, places).catch(function () {
    renderFallback(container, places, note);
  });
}
