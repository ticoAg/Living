---
type: Architecture
title: 架构总览
description: 单个 Cloudflare Worker 提供 SPA 静态资源、JSON API 与媒体文件；关系数据和地点缓存在 D1，图片在 R2，会话与登录限流在 KV；图片处理在浏览器完成。
tags: [architecture]
---
# 组成

```
浏览器 (React SPA, MapLibre)
  │  静态资源：Workers Static Assets（SPA 回退到 index.html）
  │  /api/*  /media/*  → 先进入 Worker（run_worker_first）
  ▼
Worker `living` (Hono)
  ├─ D1  `living`         用户、照片、标签、地点、主题、邀请、设置；地点与逆地理缓存 place_cache
  ├─ R2  `living-photos`  原图 o/{ownerId}/{photoId}.{ext}，尺寸图 v/{photoId}/{s|m|l}.{webp|jpg}
  ├─ KV  `living-kv`      会话 sess:*、登录限流 rl:*（KV 每天 1000 次写入只留给登录）
  ├─ 外部：高德 Web 服务（可选）、OpenStreetMap Photon / Nominatim（Overpass 作后备）
  └─ 定时任务：每小时补全照片的省份、清理过期的地点缓存（Cron 触发器，见 Cloudflare 资源）
地图瓦片：OpenFreeMap（浏览器直连）
```

# 请求路径

- 页面：`living.ticoag.fun/*` 命中静态资源；不存在的路径回退到 `index.html`，由前端路由处理。
- API：`/api/*` 进入 Worker，按 [接口约定](/api/conventions.md) 返回 JSON。
- 媒体：`/media/v/*` 公开尺寸图走 Cache API 与一年 immutable 缓存；私密照片与原图只对本人返回且不缓存。见 [媒体接口](/api/media.md)。

# 图片管线

浏览器读取 EXIF、旋正、生成三种尺寸、ThumbHash 与主色、计算 SHA-256，再以 multipart 一次上传原图与尺寸图。Worker 只做校验、写 R2 和 D1，不做图像运算，因此不需要付费的图像服务，也不受 Worker CPU 限制。理由见 [决策：浏览器端处理图片](/architecture/decisions/0002-client-side-images.md)。

# 地点匹配

Worker 合并站内地点与外部候选，按距离和朝向打分；外部结果缓存在 D1 的 [place_cache](/data/place-cache.md)。见 [地点匹配](/product/features/poi-matching.md) 和 [地点接口](/api/pois.md)。

# 认证

用户名 + 密码（PBKDF2-SHA256），会话令牌存 KV，Cookie 携带。见 [账号](/product/features/accounts.md) 和 [认证接口](/api/auth.md)。

# 数据规模假设

单站数千张照片。图库、地图、索引一次取回可见照片的精简列表，在浏览器里筛选；照片详情、主题按需取。列表一次最多 5000 张（`PHOTO_LIST_LIMIT`），超过时只返回拍摄时间最新的 5000 张，响应带 `truncated: true`，图库、地图和索引显示「只显示最近的 5000 张」，更早的照片在这些页面上看不到，见 [照片接口](/api/photos.md#get-apiphotos)。照片接近这个数量时再引入分页与服务端筛选。

# 部署

推送 `main` 由 Workers Builds 自动构建与部署，见 [构建与发布](/architecture/ci-cd.md)；资源清单见 [Cloudflare 资源](/architecture/cloudflare.md)。
