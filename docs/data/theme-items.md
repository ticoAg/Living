---
type: D1 Table
title: theme_items
description: 主题的有序条目：照片、文字段落或日期分段。
tags: [data, d1, themes]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `it_<ulid>`；整体替换条目时重新生成 |
| `theme_id` | TEXT | 非空，外键 → `themes.id`，删除时级联删除 | 所属主题 |
| `position` | INTEGER | 非空 | 顺序，从 0 起 |
| `kind` | TEXT | 非空，默认 `'photo'`，取值 `photo` `text` `day` | 条目类型：照片、文字段落、日期分段 |
| `photo_id` | TEXT | 可空，外键 → `photos.id`，删除时级联删除 | 仅 `photo` 条目使用 |
| `text` | TEXT | 可空 | `photo`：本主题内的说明，优先于照片笔记；`text`：段落正文；`day`：当天的说明（可选） |
| `day` | TEXT | 可空 | 仅 `day` 条目使用：日期 `YYYY-MM-DD` |

索引：

- `theme_items_theme`（`theme_id`, `position`）：按顺序读取一个主题的条目。
- `theme_items_photo`（`photo_id`）：照片被删除时级联查找。

# 关系

- 属于 [themes](/data/themes.md)；主题删除时条目级联删除。
- `photo_id` 引用 [photos](/data/photos.md)；照片删除时对应条目一并删除，不留空位。
- 功能说明：[主题](/product/features/themes.md)、[游记](/product/features/travelogue.md)、[照片笔记](/product/features/photo-notes.md)。接口：[主题接口](/api/themes.md)。

# 规则

- 条目只能放主题所有者自己的照片。
- 一张照片可以出现在多个主题，也可以在同一个主题里出现多次，表上不限制。
- `position` 不要求唯一；`PUT /api/themes/:id/items` 整体替换时按数组顺序从 0 重新写入。
- 旅程创建时，按拍摄时间排序并在每天第一张照片前插入一个 `day` 条目。

# 隐私

读取主题时，请求者看不到的照片条目，`photo` 字段为 `null`，前端跳过；条目本身的文字仍然返回。
