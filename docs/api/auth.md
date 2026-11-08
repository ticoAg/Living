---
type: API
title: 认证与站点
description: 站点信息、注册、登录、退出、当前用户与个人资料接口。
tags: [api, account]
---
# GET /api/site

返回 `SiteInfo`：`name`、`url`、`registration`（invite/open/closed）、`hasAmap`、`needsSetup`（还没有任何用户）。

# GET /api/auth/me

`{ "user": SessionUser | null }`，永不返回 401。

# POST /api/auth/register

请求 `{ "invite"?: string, "handle": string, "displayName": string, "password": string }` → 201 `{ "user": SessionUser }` 并设置会话 Cookie。

- `handle`：`^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$`，不区分大小写唯一，且不在保留名单（admin api media living login register settings studio themes upload map index place t p www root owner）。
- `password`：至少 8 个字符。`displayName`：1–40 字符。
- `needsSetup` 时必须提供角色为 `owner` 的有效邀请码。之后按 `registration`：`invite` 需要有效邀请码；`open` 不需要（提供则按邀请码角色）；`closed` 返回 403。
- 邀请码有效 = 存在、未使用、未过期；使用后写入 `used_by`、`used_at`，用户角色取邀请码的 `role`。
- 密码存储：`pbkdf2$100000$<salt base64>$<hash base64>`，SHA-256，32 字节输出。
- 新用户不会复制预置标签；预置标签通过 `owner_id IS NULL` 对所有人可见。

# POST /api/auth/login

请求 `{ "handle", "password" }` → `{ "user": SessionUser }` 并设置 Cookie。失败统一返回 401 `{ "error": "unauthenticated", "message": "用户名或密码不对" }`。KV 计数 `rl:login:<ip>:<handle>`，每分钟超过 5 次返回 429。

# POST /api/auth/logout

删除 KV 会话并清除 Cookie → `{ "ok": true }`。

# PATCH /api/me（登录）

请求 `{ "displayName"?, "bio"?, "avatarPhotoId"? }`（头像必须是自己的照片）→ `{ "user": SessionUser }`。

# POST /api/me/password（登录）

请求 `{ "current", "next" }` → `{ "ok": true }`；当前密码不对返回 400。成功后其他会话不强制下线。
