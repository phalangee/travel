/* 通用工具函数 */
'use strict';

function getQuery(name) {
  return new URLSearchParams(location.search).get(name);
}

/* 高德 URI：唤起高德 App 或网页版查看/导航到某坐标 */
function amapMarkerUri(lng, lat, name) {
  return 'https://uri.amap.com/marker?position=' + lng + ',' + lat +
    '&name=' + encodeURIComponent(name || '') + '&src=mytravel&coordinate=gaode&callnative=1';
}

function amapNavUri(lng, lat, name) {
  return 'https://uri.amap.com/navigation?to=' + lng + ',' + lat + ',' +
    encodeURIComponent(name || '目的地') + '&mode=car&src=mytravel&coordinate=gaode&callnative=1';
}

function loadJSON(url) {
  return fetch(url, { cache: 'no-cache' }).then(function (res) {
    if (!res.ok) throw new Error('加载失败 ' + url + ' ' + res.status);
    return res.json();
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtDateCN(iso) {
  const parts = iso.split('-');
  return (+parts[1]) + '月' + (+parts[2]) + '日';
}

function weekdayCN(iso) {
  return '周' + '日一二三四五六'.charAt(new Date(iso + 'T00:00:00').getDay());
}

function daysBetween(startISO, endISO) {
  const ms = new Date(endISO) - new Date(startISO);
  return Math.round(ms / 86400000) + 1;
}

function todayISO() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 旅行状态：planned / ongoing / done（按今天日期自动判断） */
function tripPhase(trip, today) {
  if (today < trip.startDate) return 'planned';
  if (today > trip.endDate) return 'done';
  return 'ongoing';
}

const STRENGTH_LABEL = { easy: '轻松', medium: '中等', hard: '辛苦' };
const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐/小吃' };
