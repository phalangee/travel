# 行程数据格式说明

一趟旅行 = `data/trips/` 下一个 JSON 文件 + `data/trips.json` 索引里一条记录。所有内容字段均为**可选**，页面按有无自动显示或隐藏。

## 1. 索引文件 `data/trips.json`

```json
{
  "trips": [
    {
      "id": "xinjiang-2026",            // 唯一ID，与数据文件名一致
      "title": "新疆北疆自驾",
      "subtitle": "带娃的秋日北疆环线",
      "region": "新疆",                  // 足迹地图标签
      "startDate": "2026-09-23",        // YYYY-MM-DD，必须与 days 首末日一致
      "endDate": "2026-10-05",
      "spotlight": [87.617, 43.792],    // 足迹地图打点坐标（GCJ-02，可省略）
      "cover": null                     // 封面图路径，null 用渐变占位
    }
  ]
}
```

状态（计划中/进行中/已完成）按今天日期自动计算，无需手工维护。

## 2. 行程文件 `data/trips/<id>.json`

顶层结构：

| 字段 | 说明 |
|---|---|
| `id` | 与文件名一致 |
| `meta` | `{ title, region, travelers, startDate, endDate }` |
| `overview` | `{ routeSummary, notes[] }` 显示在行程页顶部 |
| `days[]` | 按天数据，dayIndex 从 1 连续，date 连续无断日 |

每个 day：

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | `"2026-09-23"` | 日期，必须连续 |
| `dayIndex` | number | 从 1 开始连续 |
| `route` | object | `{ from, to, driveTime }`；from==to 表示驻地日 |
| `lodging` | object/null | `{ city, hotel, booking?, location:[lng,lat], nights }`；返程日可为 null；`booking` 为预定渠道（携程/去哪儿/小程序…），页面显示为「已订 · 渠道」徽标 |
| `strength` | `"easy"/"medium"/"hard"` | 显示为轻松/中等/辛苦 |
| `highlights` | string[] | 总览卡要点（前缀自动加★） |
| `scenery` | string | 沿途风景说明（行程Tab顶部显示） |
| `map.places` | array | `{ name, type, location:[lng,lat], address?, note? }`；type ∈ lodging/scenic/food/transfer |
| `timeline` | array | `{ time, title, detail?, duration? }` 时间轴 |
| `food` | array | `{ meal: breakfast/lunch/dinner/snack, title, detail?, searchKeyword? }` |
| `shopping` | array | `{ title, detail }` 显示在美食Tab |
| `prep.clothing` | string[] | 衣物·天气 |
| `prep.carry` | string[] | 随身包物品 |
| `prep.tickets` | array | `{ title, detail, status: "todo"/"done" }` 门票·证件·预约 |
| `prep.tips` | string[] | 贴士 |

坐标统一使用**高德坐标系（GCJ-02）**，可用高德坐标拾取器（https://lbs.amap.com/tools/picker）查取。

## 3. 新增一趟旅行的步骤

1. 复制一份行程 JSON 为 `data/trips/<新id>.json`，改内容；
2. 在 `data/trips.json` 的 `trips` 数组加一条索引；
3. 运行 `node tools/validate.mjs` 确认通过；
4. （部署时）更新 `sw.js` 中的 `PRECACHE` 列表加入新数据文件，并把 `CACHE_VERSION` 加一。

当前首版坐标为近似值，后续可精化，不影响页面结构。
