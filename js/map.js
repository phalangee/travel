/* 地图模块：高德静态地图图片（v3/staticmap）
 * 需要 Web 服务类型的 Key（与 JS API Key 不同）
 * 无 Key 或加载失败时降级为有序地点条 */
'use strict';

const PLACE_TYPE = {
  lodging: { label: '住宿', color: '#2563eb' },
  scenic: { label: '景点', color: '#f59e0b' },
  food: { label: '餐购', color: '#ef4444' },
  transfer: { label: '换乘', color: '#6b7280' }
};

/* ---------- 静态地图图片 ---------- */
function staticMapUrl(places, width, height) {
  var pts = (places || []).filter(function (p) { return p.location; });
  if (!pts.length) return null;

  var w = width || 600;
  var h = height || 300;
  var markers = [];
  var path = [];

  pts.forEach(function (p, i) {
    var color = (PLACE_TYPE[p.type] || PLACE_TYPE.scenic).color.replace('#', '0x');
    markers.push('mid,' + color + ',' + (i + 1) + ':' + p.location[0] + ',' + p.location[1]);
    path.push(p.location[0] + ',' + p.location[1]);
  });

  var url = 'https://restapi.amap.com/v3/staticmap?' +
    'key=' + encodeURIComponent(CONFIG.amapKey) +
    '&size=' + w + '*' + h +
    '&markers=' + markers.join('|');

  if (path.length > 1) {
    url += '&paths=' + '2,0x2563eb,1,,:,' + path.join(';');
  }

  return url;
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

/* ---------- 统一入口：静态地图 + 降级 ---------- */
function initPlaceMap(container, places, note) {
  if (!container) return;

  var url = staticMapUrl(places, 600, 300);
  if (!url) {
    renderFallback(container, places, note);
    return;
  }

  renderLoading(container);

  // 尝试加载静态地图图片
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
  };
  img.onerror = function() {
    console.warn('地图图片加载失败，URL:', url);
    renderFallback(container, places, note, '地图加载失败，显示地点列表');
  };
  img.src = url;

  // 超时降级（手机网络慢，延长到 8 秒）
  setTimeout(function() {
    if (!container.querySelector('img')) {
      renderFallback(container, places, note, '地图加载超时，显示地点列表');
    }
  }, 8000);
}

/* 主页足迹图 */
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

  // 超时隐藏
  setTimeout(function() {
    if (!container.querySelector('img')) {
      container.hidden = true;
    }
  }, 8000);
}
