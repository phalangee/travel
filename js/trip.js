/* 行程页：日期条 + 按天划卡 + Tab */
'use strict';

(function () {
  const TABS = [
    { key: 'plan', label: '行程' },
    { key: 'food', label: '美食·购物' },
    { key: 'prep', label: '准备' }
  ];

  function buildDayBar(trip, todayPhase, todayIndex) {
    const bar = document.getElementById('day-bar');
    bar.textContent = '';
    trip.days.forEach(function (day) {
      const btn = el('button', 'day-bar__item');
      const isToday = todayPhase === 'ongoing' && day.dayIndex === todayIndex;
      if (isToday) btn.classList.add('day-bar__item--today');
      btn.dataset.dayIndex = day.dayIndex;
      btn.appendChild(el('span', 'day-bar__d', 'D' + day.dayIndex));
      btn.appendChild(el('span', 'day-bar__date', (+day.date.slice(5, 7)) + '.' + (+day.date.slice(8))));
      if (isToday) btn.appendChild(el('span', 'day-bar__today', '今天'));
      btn.addEventListener('click', function () {
        const target = document.querySelector('.day[data-day-index="' + day.dayIndex + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
      bar.appendChild(btn);
    });
  }

  function buildOverview(day) {
    const card = el('section', 'day-card__overview');

    const head = el('div', 'day-card__head');
    head.appendChild(el('h2', 'day-card__title', 'D' + day.dayIndex + ' · ' + fmtDateCN(day.date) + ' ' + weekdayCN(day.date)));
    if (day.strength && STRENGTH_LABEL[day.strength]) {
      head.appendChild(el('span', 'chip chip--strength-' + day.strength, STRENGTH_LABEL[day.strength]));
    }
    card.appendChild(head);

    const info = el('ul', 'day-card__info');
    const route = day.route || {};
    if (route.from && route.to && route.from !== route.to) {
      info.appendChild(el('li', 'day-card__info-item', '🚗 ' + route.from + ' → ' + route.to +
        (route.driveTime ? '（车程约 ' + route.driveTime + '）' : '')));
    } else if (route.to) {
      info.appendChild(el('li', 'day-card__info-item', '📍 ' + route.to));
    }
    if (day.lodging && day.lodging.city) {
      info.appendChild(el('li', 'day-card__info-item', '🏨 住宿：' + day.lodging.city +
        (day.lodging.hotel ? ' · ' + day.lodging.hotel : '') +
        (day.lodging.nights > 1 ? '（连住' + day.lodging.nights + '晚）' : '')));
    }
    (day.highlights || []).forEach(function (h) {
      info.appendChild(el('li', 'day-card__info-item day-card__info-item--hl', '★ ' + h));
    });
    card.appendChild(info);

    const mapBox = el('div', 'day-card__map');
    mapBox.setAttribute('role', 'img');
    mapBox.setAttribute('aria-label', 'D' + day.dayIndex + ' 路线图');
    card.appendChild(mapBox);
    const places = (day.map && day.map.places) || [];
    initPlaceMap(mapBox, places, '当日路线');

    return card;
  }

  function buildTimeline(day) {
    const box = el('div', 'tab-panel');

    if (day.scenery) {
      box.appendChild(buildSection('沿途风景', '🌿', [day.scenery]));
    }

    if (day.timeline && day.timeline.length) {
      const tl = el('ol', 'timeline');
      day.timeline.forEach(function (item) {
        const li = el('li', 'timeline__item');
        const time = el('div', 'timeline__time', item.time || '');
        li.appendChild(time);
        const body = el('div', 'timeline__body');
        body.appendChild(el('div', 'timeline__title', item.title));
        if (item.duration) body.appendChild(el('span', 'chip chip--soft', item.duration));
        if (item.detail) body.appendChild(el('p', 'timeline__detail', item.detail));
        li.appendChild(body);
        tl.appendChild(li);
      });
      box.appendChild(tl);
    } else {
      box.appendChild(el('p', 'empty-hint', '这一天没有安排时间线，随性游玩。'));
    }
    return box;
  }

  function buildFood(day) {
    const box = el('div', 'tab-panel');
    const food = day.food || [];
    if (!food.length && !(day.shopping || []).length) {
      box.appendChild(el('p', 'empty-hint', '这一天暂无美食记录。'));
      return box;
    }
    if (food.length) {
      const list = el('div', 'food-list');
      food.forEach(function (f) {
        const item = el('div', 'food-item');
        const head = el('div', 'food-item__head');
        head.appendChild(el('span', 'chip chip--meal', MEAL_LABEL[f.meal] || f.meal || '用餐'));
        if (f.title) head.appendChild(el('span', 'food-item__title', f.title));
        item.appendChild(head);
        if (f.detail) item.appendChild(el('p', 'food-item__detail', f.detail));
        if (f.searchKeyword) {
          const a = el('a', 'food-item__search', '在高德搜索「' + f.searchKeyword + '」↗');
          a.href = 'https://uri.amap.com/search?keyword=' + encodeURIComponent(f.searchKeyword) + '&src=mytravel';
          a.target = '_blank'; a.rel = 'noopener';
          item.appendChild(a);
        }
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    if (day.shopping && day.shopping.length) {
      box.appendChild(buildSection('购物建议', '🛍', day.shopping.map(function (s) {
        return (s.title ? s.title + '：' : '') + (s.detail || '');
      })));
    }
    return box;
  }

  function buildPrep(day) {
    const box = el('div', 'tab-panel');
    const prep = day.prep || {};
    let empty = true;

    if (prep.clothing && prep.clothing.length) {
      box.appendChild(buildSection('衣物·天气', '🧥', prep.clothing)); empty = false;
    }
    if (prep.carry && prep.carry.length) {
      box.appendChild(buildSection('随身包物品', '🎒', prep.carry)); empty = false;
    }
    if (prep.tickets && prep.tickets.length) {
      const items = prep.tickets.map(function (t) {
        const status = t.status === 'done' ? '✅ ' : '🎫 ';
        return status + (t.title ? t.title + ' — ' : '') + (t.detail || '');
      });
      box.appendChild(buildSection('门票·证件·预约', '🎟', items)); empty = false;
    }
    if (prep.tips && prep.tips.length) {
      box.appendChild(buildSection('贴士', '💡', prep.tips)); empty = false;
    }
    if (empty) box.appendChild(el('p', 'empty-hint', '这一天暂无特别提醒。'));
    return box;
  }

  function buildSection(title, icon, lines) {
    const sec = el('section', 'block');
    sec.appendChild(el('h3', 'block__title', icon + ' ' + title));
    const ul = el('ul', 'block__list');
    lines.forEach(function (line) { ul.appendChild(el('li', 'block__item', line)); });
    sec.appendChild(ul);
    return sec;
  }

  function hasTabContent(day, key) {
    if (key === 'plan') return true; // 时间轴缺省也有空态
    if (key === 'food') return !!(day.food && day.food.length) || !!(day.shopping && day.shopping.length);
    if (key === 'prep') {
      const p = day.prep || {};
      return !!(p.clothing || p.carry || p.tickets || p.tips);
    }
    return false;
  }

  function buildTabs(day) {
    const nav = el('nav', 'tabs');
    const panels = el('div', 'tab-panels');
    let firstActive = false;

    TABS.forEach(function (tab) {
      if (!hasTabContent(day, tab.key)) return;
      const btn = el('button', 'tabs__btn', tab.label);
      btn.dataset.tab = tab.key;
      const panel = tab.key === 'plan' ? buildTimeline(day)
        : tab.key === 'food' ? buildFood(day)
        : buildPrep(day);
      panel.dataset.tabPanel = tab.key;
      if (!firstActive) {
        btn.classList.add('tabs__btn--active');
        panel.classList.add('tab-panel--active');
        firstActive = true;
      } else {
        panel.classList.add('tab-panel--hidden');
      }
      btn.addEventListener('click', function () {
        const scope = nav.parentElement;
        scope.querySelectorAll('.tabs__btn').forEach(function (b) { b.classList.remove('tabs__btn--active'); });
        scope.querySelectorAll('.tab-panel').forEach(function (p) {
          p.classList.remove('tab-panel--active');
          p.classList.add('tab-panel--hidden');
        });
        btn.classList.add('tabs__btn--active');
        panel.classList.add('tab-panel--active');
        panel.classList.remove('tab-panel--hidden');
      });
      nav.appendChild(btn);
      panels.appendChild(panel);
    });

    const wrap = el('div', 'day-card__tabs');
    wrap.appendChild(nav);
    wrap.appendChild(panels);
    return wrap;
  }

  function buildDay(day) {
    const section = el('section', 'day');
    section.dataset.dayIndex = day.dayIndex;
    const card = el('article', 'day-card');
    card.appendChild(buildOverview(day));
    card.appendChild(buildTabs(day));
    section.appendChild(card);
    return section;
  }

  function renderTrip(trip) {
    document.title = trip.meta.title + ' · 我的旅行';
    document.getElementById('trip-title').textContent = trip.meta.title;
    document.getElementById('trip-title-inline').textContent = trip.meta.title;

    const meta = document.getElementById('trip-meta');
    const bits = [fmtDateCN(trip.meta.startDate) + ' – ' + fmtDateCN(trip.meta.endDate),
      trip.days.length + '天', trip.meta.travelers].filter(Boolean);
    meta.textContent = bits.join(' · ');

    const summary = document.getElementById('route-summary');
    if (trip.overview && trip.overview.routeSummary) {
      summary.textContent = trip.overview.routeSummary;
    }

    // 全程路线图：住宿点顺序连线
    var routeMapBox = document.getElementById('route-map');
    var lodgingPlaces = [];
    trip.days.forEach(function (d) {
      if (d.lodging && d.lodging.location) {
        lodgingPlaces.push({ name: 'D' + d.dayIndex + ' ' + d.lodging.city, type: 'lodging', location: d.lodging.location, note: d.lodging.hotel });
      } else if (d.map && d.map.places && d.map.places.length) {
        var last = d.map.places[d.map.places.length - 1];
        if (last.location && last.type === 'lodging') {
          lodgingPlaces.push({ name: 'D' + d.dayIndex + ' ' + last.name, type: 'lodging', location: last.location });
        }
      }
    });
    initPlaceMap(routeMapBox, lodgingPlaces, '全程路线');

    // 日期条 + 日卡
    const today = todayISO();
    const phase = tripPhase(trip.meta, today);
    let todayIndex = null;
    if (phase === 'ongoing') {
      trip.days.forEach(function (d) { if (d.date === today) todayIndex = d.dayIndex; });
    }
    buildDayBar(trip, phase, todayIndex);

    const deck = document.getElementById('day-deck');
    deck.textContent = '';
    trip.days.forEach(function (d) { deck.appendChild(buildDay(d)); });

    if (todayIndex) {
      const target = deck.querySelector('.day[data-day-index="' + todayIndex + '"]');
      if (target) {
        requestAnimationFrame(function () {
          deck.scrollLeft = target.offsetLeft - deck.offsetLeft;
          const btn = document.querySelector('.day-bar__item--today');
          if (btn) btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        });
      }
    }
  }

  const id = getQuery('id');
  if (!id) {
    document.getElementById('trip-title').textContent = '缺少行程参数';
    return;
  }
  loadJSON('data/trips/' + encodeURIComponent(id) + '.json')
    .then(renderTrip)
    .catch(function (err) {
      document.getElementById('trip-title').textContent = '行程加载失败';
      document.getElementById('route-summary').textContent = err.message;
      console.error(err);
    });
})();
