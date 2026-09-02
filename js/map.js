/* 地图模块：高德 JS API 2.0 动态地图
 * 需要 JS API Key + securityJsCode
 * 并发控制：最多同时存在 2 个地图实例
 * 懒加载：IntersectionObserver 进入视口才初始化
 * 销毁机制：离开视口时销毁释放内存
 * 降级：加载失败时显示有序地点条
 */
'use strict';

const PLACE_TYPE = {
  lodging: { label: '住宿', color: '#2563eb', icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png' },
  scenic:  { label: '景点', color: '#f59e0b', icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_r.png' },
  food:    { label: '餐购', color: '#ef4444', icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_r.png' },
  transfer:{ label: '换乘', color: '#6b7280', icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_g.png' }
};

/* ---------- AMapLoader 单例加载 ---------- */
var amapReady = false;
var amapLoading = false;
var amapCallbacks = [];

function loadAMap(callback) {
  if (amapReady && window.AMap) {
    callback(window.AMap);
    return;
  }
  amapCallbacks.push(callback);
  if (amapLoading) return;
  amapLoading = true;

  // 设置安全密钥
  if (CONFIG.securityJsCode) {
    window._AMapSecurityConfig = { securityJsCode: CONFIG.securityJsCode };
  }

  // 加载 loader.js
  var loader = document.createElement('script');
  loader.src = 'https://webapi.amap.com/loader.js';
  loader.onload = function () {
    if (!window.AMapLoader) {
      failAll('AMapLoader 未找到');
      return;
    }
    window.AMapLoader.load({
      key: CONFIG.amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar']
    }).then(function (AMap) {
      amapReady = true;
      amapLoading = false;
      amapCallbacks.forEach(function (cb) { cb(AMap); });
      amapCallbacks = [];
    }).catch(function (err) {
      failAll('AMap 加载失败: ' + (err && err.message ? err.message : '未知错误'));
    });
  };
  loader.onerror = function () {
    failAll('loader.js 加载失败');
  };
  document.head.appendChild(loader);
}

function failAll(msg) {
  amapLoading = false;
  console.error('[Map]', msg);
  amapCallbacks.forEach(function (cb) { cb(null, msg); });
  amapCallbacks = [];
}

/* ---------- 地图实例管理（并发控制：最多 2 个） ---------- */
var activeMaps = []; // [{ container, map }]
var MAX_CONCURRENT_MAPS = 2;

function registerMap(container, map) {
  // 如果超出限制，销毁最早的
  while (activeMaps.length >= MAX_CONCURRENT_MAPS) {
    var oldest = activeMaps.shift();
    if (oldest && oldest.map) {
      try { oldest.map.destroy(); } catch (e) { /* ignore */ }
      if (oldest.container) oldest.container.innerHTML = '';
    }
  }
  activeMaps.push({ container: container, map: map });
}

function unregisterMap(container) {
  for (var i = 0; i < activeMaps.length; i++) {
    if (activeMaps[i].container === container) {
      var rec = activeMaps.splice(i, 1)[0];
      if (rec && rec.map) {
        try { rec.map.destroy(); } catch (e) { /* ignore */ }
      }
      return;
    }
  }
}

/* ---------- 降级渲染：有序地点条 ---------- */
function renderFallback(container, places, note, failMsg) {
  container.textContent = '';
  container.classList.add('map-fallback');
  if (failMsg) {
    container.appendChild(el('p', 'map-fallback__note', failMsg));
  } else if (note) {
    container.appendChild(el('p', 'map-fallback__note', note));
  }
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

/* ---------- 加载提示 ---------- */
function renderLoading(container) {
  container.textContent = '';
  container.classList.add('map-fallback');
  var p = el('p', 'map-fallback__note', '🗺️ 地图加载中…');
  p.style.padding = '40px 0';
  container.appendChild(p);
}

/* ---------- 创建动态地图 ---------- */
function createDynamicMap(container, places, note, drawPath) {
  renderLoading(container);

  loadAMap(function (AMap, err) {
    if (!AMap) {
      renderFallback(container, places, note, err || '地图加载失败');
      return;
    }

    var pts = (places || []).filter(function (p) { return p.location; });
    if (!pts.length) {
      renderFallback(container, places, note);
      return;
    }

    try {
      // 计算中心点
      var lngs = pts.map(function (p) { return p.location[0]; });
      var lats = pts.map(function (p) { return p.location[1]; });
      var center = [
        (Math.min.apply(null, lngs) + Math.max.apply(null, lngs)) / 2,
        (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2
      ];

      // 创建地图
      var map = new AMap.Map(container, {
        zoom: 11,
        center: center,
        viewMode: '2D',
        dragEnable: true,
        zoomEnable: true,
        touchZoom: true,
        doubleClickZoom: true,
        scrollWheel: false // 防止页面滚动时误触地图缩放
      });

      // 添加标记
      pts.forEach(function (p, i) {
        var marker = new AMap.Marker({
          position: p.location,
          title: p.name,
          label: {
            content: String(i + 1),
            offset: new AMap.Pixel(0, 0),
            direction: 'bottom'
          }
        });
        map.add(marker);
      });

      // 添加折线
      if (drawPath && pts.length > 1) {
        var pathLine = new AMap.Polyline({
          path: pts.map(function (p) { return p.location; }),
          strokeColor: '#3b82f6',
          strokeWeight: 3,
          strokeOpacity: 0.9,
          strokeStyle: 'solid',
          showDir: true
        });
        map.add(pathLine);
      }

      // 自动调整视野包含所有标记
      map.setFitView(null, false, [40, 40, 40, 40]);

      // 注册到活跃列表
      registerMap(container, map);

      // 监听容器尺寸变化，重新调整
      var resizeTimer;
      var onResize = function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (map) map.resize();
        }, 200);
      };
      window.addEventListener('resize', onResize);

      // 保存清理函数
      container.__mapCleanup = function () {
        window.removeEventListener('resize', onResize);
        unregisterMap(container);
      };

    } catch (e) {
      console.error('[Map] 创建地图失败:', e);
      renderFallback(container, places, note, '地图初始化失败');
    }
  });
}

/* ---------- 懒加载观察器（共享实例） ---------- */
var mapObserver = null;
function getMapObserver() {
  if (mapObserver) return mapObserver;
  mapObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var rec = entry.target.__mapRec;
      if (!rec) return;

      if (entry.isIntersecting) {
        // 进入视口：初始化地图
        if (!rec.initialized) {
          rec.initialized = true;
          createDynamicMap(entry.target, rec.places, rec.note, rec.drawPath);
        }
      } else {
        // 离开视口：销毁地图释放内存（可选，根据性能调整）
        if (rec.initialized && entry.target.__mapCleanup) {
          entry.target.__mapCleanup();
          entry.target.__mapCleanup = null;
          rec.initialized = false;
          // 清空容器，下次进入时重新初始化
          entry.target.innerHTML = '';
          entry.target.classList.remove('map-fallback');
        }
      }
    });
  }, { rootMargin: '50px 0px', threshold: 0 });
  return mapObserver;
}

/* ---------- 统一入口：懒加载动态地图 ----------
 * @param {boolean} drawPath - 是否在标记点之间画折线
 */
function initPlaceMap(container, places, note, drawPath) {
  if (!container) return;

  var pts = (places || []).filter(function (p) { return p.location; });
  if (!pts.length) {
    renderFallback(container, places, note);
    return;
  }

  container.__mapRec = {
    places: places,
    note: note || '',
    drawPath: !!drawPath,
    initialized: false
  };

  if ('IntersectionObserver' in window) {
    getMapObserver().observe(container);
  } else {
    // 老浏览器直接加载
    container.__mapRec.initialized = true;
    createDynamicMap(container, places, note, drawPath);
  }
}

/* 主页足迹图 */
function renderFootprintMap(container, spots) {
  if (!container || !spots.length) return;
  initPlaceMap(container, spots, '足迹地图', false);
}
