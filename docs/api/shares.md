---
type: API
title: 分享链接接口
description: 分享链接的新建、列出、删除与打开：一个链接打开一条记录、一个合集或一个项目，连同里面显示的照片和已完成的记录，可随时删除，可设有效期。
tags: [api, sharing, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/shares.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/shares.ts
    title: 授权规则
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
分享链接是 `/s/<token>` 这样的地址：作者为自己的一条记录、一个合集或一个项目生成，交给想给看的人。拿到链接的人不用登录，就能看到这一项和里面显示的内容，不管它们各自的公开范围；作者删掉链接或链接过期后立刻失效。功能说明见 [分享链接](/product/features/sharing.md)，表见 [share_links](/data/share-links.md)。

# 能看到什么

| 分享的是 | 打开的人能看到 |
|---|---|
| 记录 | 这条记录、它的全部照片和附件。记录改回草稿或归档后链接打不开，恢复后又能打开 |
| 合集 | 这个合集、它的封面和照片条目，以及其中已完成的记录和这些记录的照片、附件 |
| 项目 | 这个项目、里程碑，以及其中已完成的记录和这些记录的照片、附件 |

- 从分享的页面点进去，能看到的那些记录页和照片页也能打开（合集里的记录、记录里的照片）。
- 不包括：草稿和已归档的记录、原图、其他的记录和照片、作者的列表和主页上不公开的内容。
- 位置照常按 [位置精度](/api/conventions.md#位置精度对非所有者) 处理：隐藏位置的照片仍然不给位置。
- 数目、封面、路线和地点按打开的人能看到的算，与阅读页一致。
- 删掉链接或链接过期，下一次请求就打不开了，已经打开的页面刷新后也一样。

# 怎么生效

1. 访问 `/s/<token>` 的页面调用 `POST /api/shares/open`。
2. 链接有效时，Worker 把 token 记进这个浏览器的 Cookie `living_shares`（HttpOnly，最多记 20 个，新的在前），返回这一项的类型和 id，页面跳到它平常的地址（`/e/:id`、`/t/:id`、`/projects/:id`）。
3. 之后读取这一项的请求都带着 Cookie。下面的接口每次都查一遍 Cookie 里的链接是否还在、是否过期，再看这个链接能不能到达所请求的内容：
   - `GET /api/entries/:id`、`GET /api/entries?project=<id>`
   - `GET /api/themes/:id`
   - `GET /api/projects/:id`
   - `GET /api/photos/:id`
   - 私密照片的 [尺寸图](/api/media.md)
   - 记录里的 [附件](/api/attachments.md#文件) 和视频的画面
4. 通过链接读到的响应带 `Cache-Control: private, no-store`，附件的文件和画面另带 `Vary: Cookie`。

Cookie 只记住这个浏览器打开过哪些链接，本身不授予任何东西；把 `/e/:id` 这样的地址转给别人，对方没有这个链接，照常按公开范围处理。

# GET /api/shares（登录）

`{ "shares": ShareLink[] }`：自己的分享链接，按创建时间倒序，过期的也在内（`expiresAt` 早于现在）。

| 参数 | 返回 |
|---|---|
| （无） | 全部 |
| `kind=<entry\|theme\|project>&id=<id>` | 这一项的链接；两个参数要一起给 |

`ShareLink`：`id`（`sl_<ulid>`）、`token`、`kind`、`targetId`、`targetTitle`（作者看到的标题；没有标题的记录用正文开头或类型名）、`createdAt`、`expiresAt`（UTC，null 表示不过期）。

# POST /api/shares（登录）

`CreateShareBody` → 201 `{ "share": ShareLink }`。

| 字段 | 规则 |
|---|---|
| `kind` | `entry`、`theme` 或 `project` |
| `id` | 必须是自己的；别人的或不存在的返回 404 |
| `expiresInDays` | 1 到 365 的整数；不给或 null 表示不过期 |

- token 是 18 个随机字节的 base64url（24 个字符），id 为 `sl_<ulid>`。
- 一项最多 20 个链接，一个人最多 500 个，超出返回 400；过期的也算在内，删掉才腾出位置。草稿记录也能先建链接，记录完成后才打得开。

# POST /api/shares/open

`{ "token": string }` → `{ "kind": ShareKind, "id": string }`，并设置 Cookie。不需要登录。

- token 不存在、已删除、已过期，或分享的记录不是已完成：404「链接不存在或已失效」。
- 同时清理 Cookie 里已经失效的链接。

# DELETE /api/shares/:id（本人）

→ `{ "ok": true }`，链接立刻失效。不是自己的或不存在：404。

删除记录、合集或项目时，它的分享链接一并删除。
