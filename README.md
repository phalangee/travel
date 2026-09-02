# travel-h5 · 我的旅行行程册

移动优先的旅行行程静态站：主页（旅行列表+足迹）+ 行程页（按天划卡、行程/美食·购物/准备三Tab、地图路线、PWA 离线）。

## 本地预览

纯静态站，但 `fetch` 加载 JSON 需要通过 HTTP 访问（直接双击打开 file:// 不行）：

```bash
cd travel-h5
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 数据校验

```bash
node tools/validate.mjs
```

## 数据格式

见 `docs/data-format.md`。页面与数据彻底分离：改行程 = 改 `data/trips/*.json`，页面代码不动。

## 接入高德地图

1. 在 [高德开放平台](https://console.amap.com/dev/key/app) 创建应用，申请「Web端(JS API)」Key；
2. 填入 `js/config.js` 的 `CONFIG.amapKey`；
3. Key 为空时自动降级为「有序地点条 + 逐点跳转高德」，不影响其他功能。

## 部署到 GitHub Pages

```bash
cd travel-h5
git init && git add . && git commit -m "init"
git remote add origin https://github.com/phalangee/travel.git
git push -u origin main
```

然后在 GitHub 仓库 Settings → Pages → Source 选 `main` 分支，访问 `https://phalangee.github.io/travel/`。

更新行程后：改数据 → 更新 `sw.js` 的 `CACHE_VERSION` → push。

## 文档

- 设计文档：`docs/2026-09-02-travel-h5-design.md`
- 实现计划：`docs/plans/2026-09-02-travel-h5-v1.md`
- 数据格式：`docs/data-format.md`
