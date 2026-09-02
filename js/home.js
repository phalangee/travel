/* 主页：旅行列表 + 足迹 */
'use strict';

(function () {
  const PHASE_LABEL = { planned: '计划中', ongoing: '进行中', done: '已完成' };

  function renderCards(trips) {
    const wrap = document.getElementById('trip-cards');
    const today = todayISO();
    wrap.textContent = '';

    const sorted = trips.slice().sort(function (a, b) {
      const order = { ongoing: 0, planned: 1, done: 2 };
      const d = order[tripPhase(a, today)] - order[tripPhase(b, today)];
      return d !== 0 ? d : (a.startDate < b.startDate ? 1 : -1);
    });

    sorted.forEach(function (trip) {
      const phase = tripPhase(trip, today);
      const card = el('a', 'trip-card trip-card--' + phase);
      card.href = 'trip.html?id=' + encodeURIComponent(trip.id);

      const cover = el('div', 'trip-card__cover');
      if (trip.cover) {
        const img = el('img', 'trip-card__img');
        img.src = trip.cover; img.alt = trip.title; img.loading = 'lazy';
        cover.appendChild(img);
      } else {
        cover.appendChild(el('span', 'trip-card__cover-placeholder', trip.region || 'TRAVEL'));
      }
      card.appendChild(cover);

      const body = el('div', 'trip-card__body');
      body.appendChild(el('h3', 'trip-card__title', trip.title));
      const days = daysBetween(trip.startDate, trip.endDate);
      body.appendChild(el('p', 'trip-card__meta',
        fmtDateCN(trip.startDate) + ' – ' + fmtDateCN(trip.endDate) + ' · ' + days + '天'));

      const tags = el('div', 'trip-card__tags');
      const chip = el('span', 'chip chip--' + phase, PHASE_LABEL[phase]);
      tags.appendChild(chip);
      if (phase === 'ongoing') {
        const n = daysBetween(trip.startDate, today);
        tags.appendChild(el('span', 'chip chip--today', '今天 D' + n));
      }
      body.appendChild(tags);
      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  function renderFootprint(trips) {
    var mapBox = document.getElementById('footprint-map');
    var fallbackBox = document.getElementById('footprint-fallback');
    var spots = trips.filter(function (t) { return t.spotlight; })
      .map(function (t) {
        return { name: t.title, type: 'scenic', location: t.spotlight, note: t.region };
      });
    if (!spots.length) return;

    // 延迟加载，避免与行程页地图同时初始化
    setTimeout(function() {
      amapLoader().then(function (AMap) {
        mapBox.textContent = '';
        mapBox.classList.add('amap-container');
        var map = new AMap.Map(mapBox, { zoom: 4, center: [87.6, 43.8], viewMode: '2D' });
        spots.forEach(function (p) {
          var marker = new AMap.Marker({
            position: p.location,
            content: markerContent('📍', 'scenic'),
            anchor: 'center',
            title: p.name
          });
          marker.on('click', function () {
            new AMap.InfoWindow({ content: infoWindowHTML(p) }).open(map, p.location);
          });
          map.add(marker);
        });
      }).catch(function () {
        mapBox.hidden = true;
        fallbackBox.hidden = false;
        spots.forEach(function (p) {
          var a = el('a', 'footprint-chip', p.name + ' ' + (p.note || ''));
          a.href = amapMarkerUri(p.location[0], p.location[1], p.name);
          a.target = '_blank'; a.rel = 'noopener';
          fallbackBox.appendChild(a);
        });
      });
    }, 500);
  }

  loadJSON('data/trips.json')
    .then(function (index) { return index.trips || []; })
    .then(function (trips) {
      if (!trips.length) {
        document.getElementById('trip-cards').textContent = '还没有行程，等待第一场旅行…';
        return;
      }
      renderCards(trips);
      renderFootprint(trips);
    })
    .catch(function (err) {
      document.getElementById('trip-cards').textContent =
        '数据加载失败：' + err.message + '（若直接打开本地文件，请通过本地服务访问，详见 README）';
      console.error(err);
    });
})();
