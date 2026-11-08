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
- `POST /api/privacy-zones` `{ "name", "lat", "lng", "radius"? }` → 201 `{ "zone": PrivacyZone }`（半径 50–5000 米，默认 300）
- `DELETE /api/privacy-zones/:id` → `{ "ok": true }`

# 邀请码（owner / admin）

- `GET /api/admin/invites` → `{ "invites": Invite[] }`，最新在前。
- `POST /api/admin/invites` `{ "role"?: "member" | "admin", "note"?, "expiresInDays"? }` → 201 `{ "invite": Invite }`。只有 owner 能生成 admin 邀请码；邀请码 10 位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`。
- `DELETE /api/admin/invites/:code` → `{ "ok": true }`（已使用的不能删，返回 409）。

# 站点设置（owner / admin）

- `GET /api/admin/settings` → `{ "registration": "invite" | "open" | "closed" }`
- `PATCH /api/admin/settings` `{ "registration" }` → 同上。
