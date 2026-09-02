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

/* ---------- 统一入口：静态地图 + 降级 ---------- */
function initPlaceMap(container, places, note) {
  if (!container) return;

  var url = staticMapUrl(places, 600, 300);
  if (!url) {
    renderFallback(container, places, note);
    return;
  }

  // 尝试加载静态地图图片
  var img = new Image();
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
    renderFallback(container, places, note);
  };
  img.src = url;

  // 超时降级
  setTimeout(function() {
    if (!container.querySelector('img')) {
      renderFallback(container, places, note);
    }
  }, 3000);
}

/* 主页足迹图 */
function renderFootprintMap(container, spots) {
  if (!container || !spots.length) return;
  var url = staticMapUrl(spots, 600, 200);
  if (!url) {
    container.hidden = true;
    return;
  }
  var img = new Image();
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
    container.hidden = true;
  };
  img.src = url;
}
