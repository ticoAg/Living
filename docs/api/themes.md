---
type: API
title: 主题接口
description: 主题列表、详情（含条目与地点）、创建、修改、整体替换条目、删除。
tags: [api, themes]
---
# GET /api/themes

`{ "themes": ThemeSummary[] }`，按 `updatedAt` 倒序。

| 参数 | 返回 |
|---|---|
| （无） | 所有用户的 `public` 主题 |
| `owner=<handle>` | 该用户对请求者可见的主题（本人含全部） |
| `mine=1` | 请求者自己的全部主题（需登录） |

`cover` 为封面照片的 `PhotoSummary`（无封面时取第一张照片），`photoCount` 为照片条目数。

# GET /api/themes/:id

`ThemeDetail`：`private` 且非本人 → 404。`items` 按 `position` 排序；照片条目的 `photo` 带 `note`，请求者看不到的照片置为 `null`（前端跳过）；`pois` 为照片引用的、位置未隐藏的地点。

# POST /api/themes（登录）

`CreateThemeBody` → 201 `{ "theme": ThemeDetail }`，id `th_<ulid>`。

- `photoIds` 必须都是自己的照片；按给定顺序写入条目。
- `kind = trip` 且提供了 `photoIds`：按拍摄时间排序，并在每天第一张前插入 `day` 条目；`startDate`/`endDate` 未给时取照片日期范围。
- `visibility` 默认 `private`；创建即为 `public` 时写入 `published_at`。

# PATCH /api/themes/:id（本人）

`UpdateThemeBody` → `{ "theme": ThemeDetail }`。首次变为 `public` 时写入 `published_at`；更新 `updated_at`。

# PUT /api/themes/:id/items（本人）

`PutThemeItemsBody` → `{ "theme": ThemeDetail }`。整体替换：删除旧条目，按数组顺序写入（`position` 从 0 起），条目 id 重新生成。照片必须属于主题所有者。

# DELETE /api/themes/:id（本人）

→ `{ "ok": true }`，条目级联删除，照片不受影响。
