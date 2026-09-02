#!/usr/bin/env node
/* 数据校验：node tools/validate.mjs
 * 检查 trips.json 索引与行程文件的一致性、日期/dayIndex 连续性、坐标格式与范围 */
'use strict';

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warns = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warns.push(msg); }

function isCoord(c) {
  return Array.isArray(c) && c.length === 2 &&
    typeof c[0] === 'number' && typeof c[1] === 'number' &&
    isFinite(c[0]) && isFinite(c[1]) &&
    c[0] >= 73 && c[0] <= 136 &&  // 中国境内经度
    c[1] >= 18 && c[1] <= 54;     // 中国境内纬度
}

function checkPlace(place, ctx) {
  if (!place.name) fail(ctx + ': place 缺少 name');
  if (place.location && !isCoord(place.location)) fail(ctx + ': 坐标非法 ' + JSON.stringify(place.location));
}

// ---- 索引 ----
const indexPath = join(root, 'data', 'trips.json');
if (!existsSync(indexPath)) { fail('缺少 data/trips.json'); }
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const tripIds = [];
(index.trips || []).forEach((t, i) => {
  const ctx = `trips[${i}]`;
  for (const k of ['id', 'title', 'startDate', 'endDate']) {
    if (!t[k]) fail(ctx + ' 缺少 ' + k);
  }
  if (t.spotlight && !isCoord(t.spotlight)) fail(ctx + ' spotlight 坐标非法');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '') === false) fail(ctx + ' startDate 格式应为 YYYY-MM-DD');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t.endDate || '') === false) fail(ctx + ' endDate 格式应为 YYYY-MM-DD');
  if (t.startDate && t.endDate && t.endDate < t.startDate) fail(ctx + ' endDate 早于 startDate');
  if (t.id) tripIds.push(t.id);
});

// ---- 每个行程文件 ----
tripIds.forEach((id) => {
  const filePath = join(root, 'data', 'trips', `${id}.json`);
  if (!existsSync(filePath)) { fail(`索引中的 ${id} 缺少数据文件 data/trips/${id}.json`); return; }
  const trip = JSON.parse(readFileSync(filePath, 'utf8'));
  const ctx = `${id}.json`;

  if (!trip.meta || !trip.meta.title) fail(ctx + ': meta.title 缺失');
  if (!Array.isArray(trip.days) || !trip.days.length) { fail(ctx + ': days 为空'); return; }

  let prevDate = null;
  trip.days.forEach((day, i) => {
    const dctx = `${ctx} days[${i}]`;
    if (typeof day.dayIndex !== 'number' || day.dayIndex !== i + 1)
      fail(`${dctx}: dayIndex 应为 ${i + 1}，实际 ${day.dayIndex}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date || '')) fail(`${dctx}: date 缺失或格式错误`);
    else if (prevDate) {
      const next = new Date(prevDate); next.setDate(next.getDate() + 1);
      const expected = next.toISOString().slice(0, 10);
      if (day.date !== expected) fail(`${dctx}: 日期不连续，应为 ${expected}，实际 ${day.date}`);
      prevDate = day.date;
    } else prevDate = day.date;

    if (day.lodging) {
      if (!day.lodging.city) warn(`${dctx}: lodging 缺少 city`);
      if (day.lodging.location && !isCoord(day.lodging.location)) fail(`${dctx}: lodging.location 坐标非法`);
    }
    if (day.map && Array.isArray(day.map.places)) {
      day.map.places.forEach((p, j) => checkPlace(p, `${dctx} places[${j}]`));
    }
    if (day.strength && !['easy', 'medium', 'hard'].includes(day.strength))
      fail(`${dctx}: strength 取值应为 easy/medium/hard`);
    if (day.timeline && !Array.isArray(day.timeline)) fail(`${dctx}: timeline 应为数组`);
  });

  // 日期范围与索引一致
  const idx = (index.trips || []).find((t) => t.id === id);
  if (idx && trip.days.length) {
    if (trip.days[0].date !== idx.startDate) fail(`${ctx}: 首日 ${trip.days[0].date} 与索引 startDate ${idx.startDate} 不一致`);
    if (trip.days[trip.days.length - 1].date !== idx.endDate) fail(`${ctx}: 末日与索引 endDate 不一致`);
  }
});

// 索引外的孤儿文件提示
import { readdirSync } from 'node:fs';
readdirSync(join(root, 'data', 'trips')).forEach((f) => {
  if (f.endsWith('.json') && !tripIds.includes(f.replace(/\.json$/, ''))) {
    warn(`data/trips/${f} 不在索引中，不会显示`);
  }
});

// ---- 结果 ----
warns.forEach((w) => console.warn('⚠️  ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('❌ ' + e));
  console.error(`\n校验失败：${errors.length} 个错误`);
  process.exit(1);
}
console.log(`✅ 校验通过：${tripIds.length} 个行程文件，索引与数据一致。`);
