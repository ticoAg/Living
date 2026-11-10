---
type: API
title: 用户与管理接口
description: 个人主页数据、隐私区域、邀请码与站点设置。
tags: [api, account, admin]
---
# GET /api/users/:handle

`UserProfile`：公开资料，`photoCount`、`themeCount` 只计对请求者可见的内容。不存在 → 404。

# 隐私区域（登录）

- `GET /api/privacy-zones` → `{ "zones": PrivacyZone[] }`
- `POST /api/privacy-zones` `{ "name", "lat", "lng", "radius"? }` → 201 `{ "zone": PrivacyZone, "hiddenPhotos": number }`（半径 50–5000 米，默认 300；每人最多 50 个）。请求者自己的照片中，坐标落在新区域内、位置精度还不是 `hidden` 的，同时改为 `hidden`；`hiddenPhotos` 是改了几张。只靠地点定位、没有自己坐标的照片不改。
- `DELETE /api/privacy-zones/:id` → `{ "ok": true }`。已改为 `hidden` 的照片不会恢复。别人的区域与不存在的一样返回 404。

# 邀请码（owner / admin）

- `GET /api/admin/invites` → `{ "invites": Invite[] }`，最新在前。
- `POST /api/admin/invites` `{ "role"?: "member" | "admin", "note"?, "expiresInDays"? }` → 201 `{ "invite": Invite }`。只有 owner 能生成 admin 邀请码；邀请码 10 位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`。
- `DELETE /api/admin/invites/:code` → `{ "ok": true }`（已使用的不能删，返回 409）。

# 站点设置（owner / admin）

- `GET /api/admin/settings` → `{ "registration": "invite" | "open" | "closed" }`
- `PATCH /api/admin/settings` `{ "registration" }` → 同上。
