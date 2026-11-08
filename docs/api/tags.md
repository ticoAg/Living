---
type: API
title: 标签接口
description: 读取预置与用户自定义的标签树，增删改用户标签。
tags: [api, tags]
---
# GET /api/tags

返回 `{ "tags": Tag[] }`（扁平列表，用 `parentId` 组成树；前端用 `src/lib/tags.ts` 构建）。

| 参数 | 返回 |
|---|---|
| （无，未登录） | 预置标签 |
| （无，已登录） | 预置标签 + 请求者自己的标签 |
| `owner=<handle>` | 预置标签 + 该用户的标签 |

`count`：直接带该标签、且对请求者可见的照片数（有 `owner` 时只算该用户的照片）。

# POST /api/tags（登录）

`{ "name", "parentId"?, "color"? }` → 201 `{ "tag": Tag }`，id 为 `t_<ulid>`，`ownerId` 为请求者。

- `parentId` 必须是预置标签或自己的标签。
- 名称 1–24 字符；同一父节点下自己的标签不能重名（不区分大小写），也不能与该父节点下的预置标签同名 → 409。
- `sort` 取同级最大值 + 10。

# PATCH /api/tags/:id

`{ "name"?, "parentId"?, "color"?, "sort"? }` → `{ "tag": Tag }`。自己的标签可改；预置标签只有 owner/admin 能改。新父节点不能是自己或自己的子孙（400）。

# DELETE /api/tags/:id

删除该标签及全部子孙（递归 CTE），并删除对应的 `photo_tags` → `{ "ok": true, "deleted": <数量> }`。权限同 PATCH。删除预置标签（只有 owner/admin 能删）时，其他用户挂在它下面的标签也会一并删除并计入数量。
