---
type: API
title: 合集接口
description: 合集（接口里叫主题）的列表、详情（含条目与地点）、创建、修改、整体替换条目、删除；条目可以是照片、文字段落、日期分段或记录。
tags: [api, themes, collections]
---
接口、表和类型沿用「主题」的名字（`/api/themes`、`themes`、`ThemeSummary`），产品里叫合集，见 [合集](/product/features/themes.md)。

# GET /api/themes

`{ "themes": ThemeSummary[] }`，按 `updatedAt` 倒序。

| 参数 | 返回 |
|---|---|
| （无） | 所有用户的 `public` 合集 |
| `owner=<handle>` | 该用户对请求者可见的合集（本人含全部） |
| `mine=1` | 请求者自己的全部合集（需登录） |

统计和封面只算请求者能打开的内容（[可见性](/api/conventions.md#可见性) 的按 id 规则）：

- `cover`：选定的封面请求者看得到时用它；否则按条目顺序，取第一张请求者看得到的照片，记录条目里的照片也算。都没有则为 `null`。
- `photoCount`：看得到的照片条目，加上能打开的记录条目里看得到的照片；同一张照片出现几次算几次，与阅读页一致。
- `entryCount`：能打开的记录条目数。

# GET /api/themes/:id

`ThemeDetail`：`private` 且非本人 → 404。`items` 按 `position` 排序：

- 照片条目的 `photo` 带 `note`；请求者看不到的照片为 `null`。
- 记录条目的 `entry` 是 `ThemeEntry`：记录的 `EntrySummary`，加上 `photos`（其中请求者看得到的照片，按记录里的顺序，不带笔记）。请求者打不开的记录（仅自己可见、草稿、已归档，且不是本人的）为 `null`。
- `photo` 或 `entry` 为 `null` 的条目仍在原位，带着条目自己的 `text`；前端跳过它们。

`pois`：照片条目和记录条目里的照片所在的地点，只算请求者看得到、位置未隐藏的照片，按第一次出现的条目顺序。

持有这个合集的 [分享链接](/api/shares.md) 时，私密的合集也能打开，作者的私密照片和已完成的私密记录也算「看得到」，计数、封面、路线和地点随之计入；位置精度照旧。这样读到的响应带 `Cache-Control: private, no-store`。

# POST /api/themes（登录）

`CreateThemeBody` → 201 `{ "theme": ThemeDetail }`，id `th_<ulid>`。

- `photoIds` 必须都是自己的照片；按给定顺序写入条目。
- `kind = trip` 且提供了 `photoIds`：按拍摄时间排序，并在每天第一张前插入 `day` 条目；`startDate`/`endDate` 未给时取照片日期范围。
- `visibility` 默认 `private`；创建即为 `public` 时写入 `published_at`。

# PATCH /api/themes/:id（本人）

`UpdateThemeBody` → `{ "theme": ThemeDetail }`。首次变为 `public` 时写入 `published_at`；更新 `updated_at`。

# PUT /api/themes/:id/items（本人）

`PutThemeItemsBody` → `{ "theme": ThemeDetail }`。整体替换：删除旧条目，按数组顺序写入（`position` 从 0 起），条目 id 重新生成。

| `kind` | 字段 | 规则 |
|---|---|---|
| `photo` | `photoId`；`text` 可选，本合集里的说明 | 照片必须属于合集所有者 |
| `text` | `text` | 不能为空 |
| `day` | `day`（`YYYY-MM-DD`）；`text` 可选 | |
| `entry` | `entryId`；`text` 可选，本合集里的说明 | 记录必须属于合集所有者。草稿、已归档、仅自己可见的记录也能放进来，别人看不到它们 |

最多 1000 个条目；说明最多 5000 字，文字段落最多 20000 字。先按顺序检查每个条目的格式，第一个不合规的条目决定错误，例如「第 3 个条目缺少 entryId」；格式都没问题，再检查照片和记录是不是都是自己的（「照片必须是你自己的照片」「记录必须是你自己的记录」）。

# DELETE /api/themes/:id（本人）

→ `{ "ok": true }`，条目级联删除，照片和记录不受影响。

删除照片或 [记录](/api/entries.md#delete-apientriesid本人) 时，它在各个合集里的条目一并删除，这些合集的 `updatedAt` 随之更新。
