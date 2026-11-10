---
type: API
title: 接口约定
description: 所有 /api 接口共用的格式、认证、错误、可见性与位置精度规则；类型定义在 shared/types.ts。
tags: [api]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# 格式

- JSON，键名 camelCase；数据库列为 snake_case，由 Worker 转换。
- 读取单个资源（`GET /api/photos/:id`、`/api/themes/:id`、`/api/users/:handle`、`/api/site`）直接返回对象本身；列表包在复数键里（`{ "photos": [...] }`）；写操作返回包装后的对象（`{ "photo": ... }`、`{ "theme": ... }`、`{ "tag": ... }`）。
- 时间：拍摄时间 `takenAt` 为本地时间 `YYYY-MM-DDTHH:mm:ss`（不带时区，时区另存 `tz`，如 `+08:00`）；其他时间为 UTC ISO 8601。
- ID：带前缀的 ULID：`u_` 用户、`ph_` 照片、`poi_` 地点、`th_` 主题、`it_` 主题条目、`t_` 用户标签、`pz_` 隐私区域；预置标签用可读的英文 id（如 `lake`）。

# 认证

- Cookie `living_session`（HttpOnly、Secure、SameSite=Lax、Path=/、30 天）。值为 32 字节随机数的 base64url，对应 KV 键 `sess:<token>`，值 `{ "userId": "...", "createdAt": "..." }`，TTL 30 天。
- 需要登录的接口未登录时返回 401。修改他人资源返回 403。
- 写操作（POST/PATCH/PUT/DELETE）校验 `Origin` 与站点同源，不同源返回 403。

# 错误

```json
{ "error": "invalid_input", "message": "用户名需要 3 到 24 个字符" }
```

| 状态 | `error` | 场景 |
|---|---|---|
| 400 | `invalid_input` | 参数缺失或格式不对 |
| 401 | `unauthenticated` | 未登录 |
| 403 | `forbidden` | 无权限、跨站写请求 |
| 404 | `not_found` | 不存在或无权查看 |
| 409 | `conflict` / `duplicate` | 重名、重复上传（附 `photoId`） |
| 413 | `too_large` | 原图超过 50 MB |
| 429 | `rate_limited` | 登录尝试过多 |
| 502 | `upstream_failed` | 高德 / OSM 不可用（地点匹配仍返回站内候选） |

`message` 用中文，直接说明原因和解决办法。

# 可见性

请求者为照片或主题的所有者时看到全部内容。对其他人：

- `public`：列表和详情都可见。
- `unlisted`：只在按 id 取详情时可见，不进入任何列表、计数和 Living。
- `private`：不可见，按 404 处理。

# 位置精度（对非所有者）

| `geoPrivacy` | `lat` `lng` | `heading` `alt` | `poiId` `poi` | `poiDistance` | `district` |
|---|---|---|---|---|---|
| `exact` | 原值 | 原值 | 原值 | 原值 | 原值 |
| `fuzzy` | `shared/geo.ts` 的 `fuzz()` 取整 | null | 原值 | null | 原值 |
| `hidden` | null | null | null | null | null |

`fuzzy` 的 `poiDistance` 为 null：`poi` 带着地点的精确坐标，再给出到它的距离，取整后的位置就被缩回到几十米内。`poiMethod` 只在 `hidden` 时为 null。

`province` 和 `city` 始终返回。列表（`PhotoSummary`）和详情（`PhotoDetail`）都带 `district`，按上表处理。

# 缓存

- 未登录请求的公开列表：`Cache-Control: public, max-age=30`；带会话的请求：`private, no-store`。
- 媒体见 [媒体](/api/media.md)。
