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
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.Driving']
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

/* ---------- 覆盖物绘制：地名标记 + 真实驾车路线 + 自动视野 ---------- */

/* 驾车路线坐标缓存：同一组途经点只请求一次规划，
 * 共享地图在日程卡之间搬家时零重复请求（离线/失败回退为直线折线）。 */
var routePathCache = {};

function drawPolyline(map, path, weight) {
  var line = new AMap.Polyline({
    path: path,
    strokeColor: '#3b82f6',
    strokeWeight: weight || 5,
    strokeOpacity: 0.9,
    strokeStyle: 'solid',
    showDir: true,
    lineJoin: 'round'
  });
  map.add(line);
  return line;
}

/* 用 AMap.Driving 获取实际道路路线并画线；pts 顺序为途经顺序。
 * 途经点上限 16：超出时按 17 个一段分段请求后首尾拼接。 */
function drawDrivingRoute(map, pts) {
  var cacheKey = pts.map(function (p) { return p.location.join(','); }).join(';');
  var cached = routePathCache[cacheKey];
  if (cached) {
    if (cached.length) { drawPolyline(map, cached); map.setFitView(); }
    return;
  }

  // 先画直线折线兜底，规划返回后替换为真实路线
  var straight = drawPolyline(map, pts.map(function (p) { return p.location; }), 3);

  var finish = function (path) {
    routePathCache[cacheKey] = path || [];
    if (!path || !path.length) return; // 失败：保留直线折线
    try { map.remove(straight); } catch (e) { /* ignore */ }
    drawPolyline(map, path, 5);
    map.setFitView();
  };

  var searchSeg = function (seg) {
    var driving = new AMap.Driving({ policy: 0 });
    var opts = {};
    if (seg.length > 2) opts.waypoints = seg.slice(1, -1).map(function (p) { return p.location; });
    driving.search(seg[0].location, seg[seg.length - 1].location, opts, function (status, result) {
      var path = [];
      if (status === 'complete' && result.routes && result.routes[0]) {
        result.routes[0].steps.forEach(function (step) {
          (step.path || []).forEach(function (ll) { path.push([ll.lng, ll.lat]); });
        });
      }
      finish(path);
    });
  };

  if (pts.length <= 18) {
    searchSeg(pts);
  } else {
    // 分段：每段 17 点（起点+15 途经点+终点），段间共享衔接点
    var all = [];
    for (var i = 0; i < pts.length - 1; i += 16) {
      all.push(pts.slice(i, Math.min(i + 17, pts.length)));
    }
    var pending = all.length, merged = [];
    all.forEach(function (seg) {
      var driving = new AMap.Driving({ policy: 0 });
      var opts = {};
      if (seg.length > 2) opts.waypoints = seg.slice(1, -1).map(function (p) { return p.location; });
      driving.search(seg[0].location, seg[seg.length - 1].location, opts, function (status, result) {
        if (status === 'complete' && result.routes && result.routes[0]) {
          result.routes[0].steps.forEach(function (step) {
            (step.path || []).forEach(function (ll) { merged.push([ll.lng, ll.lat]); });
          });
        }
        if (--pending === 0) finish(merged.length ? merged : null);
      });
    });
  }
}

/* 标记图层：带碰撞检测的 LabelMarker，标签互相重叠时自动隐藏
 * 优先级低（rank 大）的标签，缩放后空间足够时自动重新显示，
 * 解决多个标记名互相遮盖的问题。短名优先（shortName），无则用全名。 */
function applyPlacesToMap(map, pts, drawPath) {
  // collision:true 仅让文字标签在重叠时自动隐藏，图标始终显示；
  // 不能开 allowCollision（图标也会互相碰撞隐藏，小视野下会全部消失）
  var labelsLayer = new AMap.LabelsLayer({
    zooms: [3, 20],
    collision: true,
    allowCollision: false
  });
  map.add(labelsLayer);
  pts.forEach(function (p, i) {
    var type = PLACE_TYPE[p.type || 'scenic'] || PLACE_TYPE.scenic;
    var marker = new AMap.LabelMarker({
      position: p.location,
      rank: 99 - Math.min(i, 90), // 靠前的途经点优先保留标签
      icon: {
        image: type.icon,
        size: [19, 31],
        anchor: 'bottom-center'
      },
      text: {
        content: (i + 1) + '. ' + (p.shortName || p.name),
        direction: 'top',
        offset: [0, -4],
        fontSize: 12,
        fillColor: '#1f2937',
        strokeColor: '#ffffff',
        strokeWidth: 2
      }
    });
    labelsLayer.add(marker);
  });
  if (drawPath && pts.length > 1) drawDrivingRoute(map, pts);
  map.setFitView(null, false, [40, 40, 40, 40]);
}

/* ---------- 跳转高德 App：navigation URI（from/to/via，坐标高德系） ---------- */
function buildAmapNavUrl(pts) {
  if (!pts || pts.length < 2) return null;
  var fmt = function (p) { return p.location.join(',') + ',' + encodeURIComponent(p.shortName || p.name); };
  var url = 'https://uri.amap.com/navigation?from=' + fmt(pts[0]) +
    '&to=' + fmt(pts[pts.length - 1]);
  var via = pts.slice(1, -1).slice(0, 16); // via 上限 16 个
  via.forEach(function (p) { url += '&via=' + fmt(p); });
  return url + '&mode=car&coordinate=gaode&callnative=1&src=mytravel';
}

/* 在地图右上角放"高德App打开"按钮（整块地图可拖动，用按钮而不是全图点击） */
function addOpenInAmapButton(container, pts) {
  if (container.__amapBtn) container.__amapBtn.remove();
  var url = buildAmapNavUrl(pts);
  if (!url) return;
  var a = document.createElement('a');
  a.className = 'map-open-amap';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '高德App打开 ↗';
  container.appendChild(a);
  container.__amapBtn = a;
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
        applyPlacesToMap(sharedDeckMap.map, spec.pts, true);
        addOpenInAmapButton(spec.container, spec.pts);
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
    settleTimer = setTimeout(function () { activate(currentTarget()); }, 300);
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
      addOpenInAmapButton(container, pts);

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

/* ---------- 离开页面时主动销毁全部实例 ----------
 * 同源导航（首页→行程页）时，旧页的 WebGL 上下文不会立刻释放，而新页
 * 马上又要创建自己的实例，低内存手机上短时叠加 3 个上下文可能触发
 * 渲染进程静默崩溃并自动刷新。pagehide 时主动 destroy，给新页腾出资源。 */
window.addEventListener('pagehide', function () {
  activeMaps.slice().forEach(destroyMapRec);
  activeMaps.length = 0;
  sharedDeckMap = null; // 共享地图随宿主 DOM 已被丢弃，仅清引用
});

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
