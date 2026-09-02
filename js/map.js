/* 地图模块：高德静态地图图片（v3/staticmap）
 * 需要 Web 服务类型的 Key（与 JS API Key 不同）
 * 无 Key 或加载失败时降级为有序地点条
 * 防超时策略：懒加载（IntersectionObserver）+ 失败重试 */
'use strict';

const PLACE_TYPE = {
  lodging: { label: '住宿', color: '#2563eb' },
  scenic: { label: '景点', color: '#f59e0b' },
  food: { label: '餐购', color: '#ef4444' },
  transfer: { label: '换乘', color: '#6b7280' }
};

/* ---------- 静态地图图片 ----------
 * @param {Array} places - 地点数组
 * @param {number} width
 * @param {number} height
 * @param {boolean} drawPath - 是否在标记点之间画折线
 */
function staticMapUrl(places, width, height, drawPath) {
  var pts = (places || []).filter(function (p) { return p.location; });
  if (!pts.length) return null;

  var w = width || 600;
  var h = height || 300;
  var markers = [];

  pts.forEach(function (p, i) {
    var color = (PLACE_TYPE[p.type] || PLACE_TYPE.scenic).color.replace('#', '0x');
    markers.push('mid,' + color + ',' + (i + 1) + ':' + p.location[0] + ',' + p.location[1]);
  });

  var params = [
    'key=' + encodeURIComponent(CONFIG.amapKey),
    'size=' + w + '*' + h,
    'markers=' + encodeURIComponent(markers.join('|'))
  ];

  // 画折线：按标记点顺序连接
  // 高德静态地图 paths 格式：weight,color,transparency,fillColor,fillOpacity:lon,lat;...
  // 折线时 fillColor 和 fillOpacity 留空，但逗号不能省略
  if (drawPath && pts.length > 1) {
    var pathPoints = pts.map(function (p) { return p.location[0] + ',' + p.location[1]; }).join(';');
    params.push('paths=' + encodeURIComponent('3,0x3b82f6,1,,:') + pathPoints);
  }

  return 'https://restapi.amap.com/v3/staticmap?' + params.join('&');
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

/* ---------- 懒加载观察器（共享实例） ---------- */
var mapObserver = null;
function getMapObserver() {
  if (mapObserver) return mapObserver;
  mapObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var rec = entry.target.__mapRec;
      if (!rec) return;
      if (entry.isIntersecting) {
        rec.visible = true;
        loadMapImage(entry.target, rec);
      }
    });
  }, { rootMargin: '100px 0px', threshold: 0 });
  return mapObserver;
}

/* ---------- 加载单张地图图片（支持重试） ---------- */
function loadMapImage(container, rec) {
  if (!rec.visible || container.__mapLoaded) return;

  var url = rec.url;
  var places = rec.places;
  var note = rec.note;
  var retries = rec.retries || 0;

  renderLoading(container);

  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.className = 'static-map-img';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = 'inherit';
  img.alt = note || '地图';

  img.onload = function() {
    container.textContent = '';
    container.appendChild(img);
    container.__mapLoaded = true;
  };

  img.onerror = function() {
    console.warn('地图图片加载失败，重试:', retries, url);
    if (retries < 1) {
      // 重试一次
      rec.retries = retries + 1;
      setTimeout(function() { loadMapImage(container, rec); }, 1000);
    } else {
      renderFallback(container, places, note, '地图加载失败，显示地点列表');
      container.__mapLoaded = true;
    }
  };

  img.src = url;

  // 超时降级（15秒，给慢网络足够时间）
  setTimeout(function() {
    if (!container.__mapLoaded) {
      console.warn('地图加载超时:', url);
      renderFallback(container, places, note, '地图加载超时，显示地点列表');
      container.__mapLoaded = true;
    }
  }, 15000);
}

/* ---------- 统一入口：懒加载静态地图 ----------
 * @param {boolean} drawPath - 是否在标记点之间画折线
 */
function initPlaceMap(container, places, note, drawPath) {
  if (!container) return;

  var pts = (places || []).filter(function (p) { return p.location; });
  if (!pts.length) {
    renderFallback(container, places, note);
    return;
  }

  var url = staticMapUrl(pts, 600, 300, drawPath);
  if (!url) {
    renderFallback(container, places, note);
    return;
  }

  container.__mapRec = { url: url, places: places, note: note || '', visible: false, retries: 0 };
  container.__mapLoaded = false;

  if ('IntersectionObserver' in window) {
    getMapObserver().observe(container);
  } else {
    // 老浏览器直接加载
    container.__mapRec.visible = true;
    loadMapImage(container, container.__mapRec);
  }
}

/* 主页足迹图（直接加载，不需要懒加载） */
function renderFootprintMap(container, spots) {
  if (!container || !spots.length) return;
  var url = staticMapUrl(spots, 600, 200);
  if (!url) {
    container.hidden = true;
    return;
  }

  renderLoading(container);

  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.className = 'static-map-img';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = 'inherit';
  img.alt = '足迹地图';
  img.onload = function() {
    container.textContent = '';
    container.appendChild(img);
  };
  img.onerror = function() {
    console.warn('足迹地图加载失败，URL:', url);
    container.hidden = true;
  };
  img.src = url;

  setTimeout(function() {
    if (!container.querySelector('img')) {
      container.hidden = true;
    }
  }, 15000);
}
