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
    }).then(function () {
      // AMapLoader.load 返回的是模块对象，不是 AMap 本身
      // 加载完成后 window.AMap 已被设置，使用全局的 window.AMap
      amapReady = true;
      amapLoading = false;
      amapCallbacks.forEach(function (cb) { cb(window.AMap); });
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

/* ---------- 地图实例管理（并发硬上限） ----------
 * 手机降到 3：高德 2.0 每实例带 Web Worker + WebGL 上下文，
 * 真机实测 4 个存活 + 滑动翻动仍可能把渲染进程撑爆。 */
var activeMaps = []; // [{ container, map, createdAt }]
var MAX_CONCURRENT_MAPS =
  (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 3 : 4;

/* 新建地图的优先保护期：初始化是异步的，刚建就销毁会在高德内部抛
 * "Cannot read properties of undefined (reading 'getOptions')"。
 * 注意这只是"优先回收顺序"，不是豁免——并发上限必须严格硬执行：
 * 每个地图实例带 Web Worker + WebGL 上下文，快速滑动时若允许超额，
 * 峰值可达 13 个实例，手机渲染进程会内存耗尽直接崩溃（Chrome 报
 * "网页重复出现问题"）。 */
var MAP_EVICTION_GRACE_MS = 1500;

function destroyMapRec(rec) {
  // 先解绑 resize 监听（__mapCleanup），再销毁地图，避免对已销毁实例调 resize()
  if (rec.container && rec.container.__mapCleanup) {
    try { rec.container.__mapCleanup(); } catch (e) { /* ignore */ }
  }
  try { rec.map.destroy(); } catch (e) { /* ignore */ }
  if (rec.container) {
    rec.container.innerHTML = '';
    // 重置懒加载状态，容器再次进入视口时可重新初始化
    if (rec.container.__mapRec) rec.container.__mapRec.initialized = false;
    if (rec.container.__mapCleanup) rec.container.__mapCleanup = null;
  }
}

function registerMap(container, map) {
  var now = Date.now();
  activeMaps.push({ container: container, map: map, createdAt: now });
  // 硬上限：存活实例绝不超 MAX_CONCURRENT_MAPS（含全程路线图在内）。
  // 全程路线图常驻不回收；其余按"最早的已过保护期者优先"回收，
  // 若全在保护期内则回收最早的——宁可承担偶发的控制台报错，
  // 也不能让实例堆积导致页面崩溃。
  while (activeMaps.length > MAX_CONCURRENT_MAPS) {
    var victim = null, fallback = null;
    for (var i = 0; i < activeMaps.length; i++) {
      var r = activeMaps[i];
      if (r.container && r.container.id === 'route-map') continue;
      if (!fallback) fallback = r;
      if (now - r.createdAt >= MAP_EVICTION_GRACE_MS) { victim = r; break; }
    }
    if (!victim) victim = fallback;
    if (!victim) break; // 只剩全程路线图，不再回收
    activeMaps.splice(activeMaps.indexOf(victim), 1);
    destroyMapRec(victim);
  }
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

/* ---------- 覆盖物绘制（标记 + 可选折线 + 自动视野） ---------- */
function applyPlacesToMap(map, pts, drawPath) {
  pts.forEach(function (p, i) {
    map.add(new AMap.Marker({
      position: p.location,
      title: p.name,
      label: {
        content: String(i + 1),
        offset: new AMap.Pixel(0, 0),
        direction: 'bottom'
      }
    }));
  });
  if (drawPath && pts.length > 1) {
    map.add(new AMap.Polyline({
      path: pts.map(function (p) { return p.location; }),
      strokeColor: '#3b82f6',
      strokeWeight: 3,
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
      showDir: true
    }));
  }
  map.setFitView(null, false, [40, 40, 40, 40]);
}

/* ---------- 日程卡共享地图：整页仅 1 个实例 ----------
 * 高德 2.0 每个实例独占 WebGL 上下文，且 destroy() 后上下文由浏览器
 * 惰性回收——按"每卡一图"方案，浏览到第 N 张卡就累计创建过 N 个
 * 上下文，真机滑到 8~9 张即耗尽，渲染进程崩溃（自动刷新/闪退）。
 * 方案：全部日程卡共用一个地图实例，滑动停稳后把宿主节点"搬家"到
 * 当前卡的地图框，只重设覆盖物；页面终生最多 2 个实例
 * （顶部全程路线图 + 本共享图）。非当前卡显示降级地点条。 */
var sharedDeckMap = null; // { host, map, owner }

function initDeckMaps(specs) {
  // specs: [{ container, places, note }]
  var withPts = [];
  specs.forEach(function (s) {
    var pts = (s.places || []).filter(function (p) { return p.location; });
    if (pts.length) withPts.push({ container: s.container, places: s.places, note: s.note || '', pts: pts });
    else renderFallback(s.container, s.places, s.note);
  });
  if (!withPts.length) return;

  var deck = withPts[0].container.closest('.day-deck');
  if (!deck) { // 找不到横向卡槽（理论不会发生），退回逐卡模式
    withPts.forEach(function (s) { initPlaceMap(s.container, s.places, s.note, false); });
    return;
  }

  // 滑动停稳后，把共享地图交给"可见宽度最大"的那张卡
  function currentTarget() {
    var best = null, bestW = -1;
    var vr = deck.getBoundingClientRect();
    withPts.forEach(function (s) {
      var r = s.container.getBoundingClientRect();
      var w = Math.min(r.right, vr.right) - Math.max(r.left, vr.left);
      if (w > bestW) { bestW = w; best = s; }
    });
    return best;
  }

  function activate(spec) {
    if (!spec) return;
    renderLoading(spec.container);
    loadAMap(function (AMap, err) {
      if (!AMap) {
        renderFallback(spec.container, spec.places, spec.note, err || '地图加载失败');
        return;
      }
      try {
        if (sharedDeckMap && sharedDeckMap.owner === spec.container) return; // 已在当前卡
        // 原宿主卡改显降级地点条
        if (sharedDeckMap) {
          var prevSpec = null;
          withPts.forEach(function (s) { if (s.container === sharedDeckMap.owner) prevSpec = s; });
          if (prevSpec) renderFallback(prevSpec.container, prevSpec.places, prevSpec.note);
        }
        spec.container.textContent = '';
        spec.container.classList.remove('map-fallback');

        if (!sharedDeckMap) {
          var host = document.createElement('div');
          host.style.width = '100%';
          host.style.height = '100%';
          spec.container.appendChild(host);
          var map = new AMap.Map(host, {
            zoom: 11,
            viewMode: '2D',
            dragEnable: true,
            zoomEnable: true,
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheel: false // 防止页面滚动时误触地图缩放
          });
          sharedDeckMap = { host: host, map: map, owner: spec.container };
          registerMap(host, map);
          var resizeTimer;
          window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { map.resize(); }, 200);
          });
        } else {
          spec.container.appendChild(sharedDeckMap.host); // DOM 节点搬家，实例与上下文不变
          sharedDeckMap.owner = spec.container;
          sharedDeckMap.map.clearMap();
        }
        applyPlacesToMap(sharedDeckMap.map, spec.pts, false);
        sharedDeckMap.map.resize();
      } catch (e) {
        console.error('[Map] 共享地图切换失败:', e);
        renderFallback(spec.container, spec.places, spec.note, '地图初始化失败');
      }
    });
  }

  var settleTimer = null;
  function onScroll() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { activate(currentTarget()); }, 500);
  }
  deck.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // 初次进入视口即定位
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
      // 清空容器，移除 fallback 样式，准备创建地图
      container.innerHTML = '';
      container.classList.remove('map-fallback');

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

      // 添加标记、折线并自动调整视野
      applyPlacesToMap(map, pts, drawPath);

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
        // 进入视口：延迟到滑动停稳再初始化（600ms 内滑走则取消）。
        // 快速滑动（fling）中建图再销毁会持续制造/销毁 WebGL 上下文，
        // 高德 destroy() 并不立即释放、Chrome 惰性回收，真机上很快
        // 耗尽上下文导致渲染进程崩溃（"网页重复出现问题"后自动重载）。
        if (!rec.initialized && !rec.initTimer) {
          rec.initTimer = setTimeout(function () {
            rec.initTimer = null;
            if (!rec.initialized) {
              rec.initialized = true;
              createDynamicMap(entry.target, rec.places, rec.note, rec.drawPath);
            }
          }, 600);
        }
      } else {
        // 离开视口：只取消未执行的初始化，不销毁已建地图。
        // 已建实例的回收完全交给 registerMap 的硬上限淘汰——
        // 有界（≤MAX_CONCURRENT_MAPS）常驻的内存是可控的，
        // 而"滑走即销毁、滑回重建"的翻动才是崩溃根源。
        if (rec.initTimer) {
          clearTimeout(rec.initTimer);
          rec.initTimer = null;
        }
      }
    });
  }, { rootMargin: '50px 0px', threshold: 0 });
  return mapObserver;
}

/* ---------- 统一入口：动态地图 ----------
 * @param {boolean} drawPath - 是否在标记点之间画折线
 * @param {boolean} lazy - 是否使用 IntersectionObserver 懒加载（默认 true）
 */
function initPlaceMap(container, places, note, drawPath, lazy) {
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

  if (lazy !== false && 'IntersectionObserver' in window) {
    getMapObserver().observe(container);
  } else {
    // 直接加载（用于全程路线图等重要地图）
    container.__mapRec.initialized = true;
    createDynamicMap(container, places, note, drawPath);
  }
}

/* 主页足迹图 */
function renderFootprintMap(container, spots) {
  if (!container || !spots.length) return;
  initPlaceMap(container, spots, '足迹地图', false);
}
