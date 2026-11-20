---
type: D1 Table
title: theme_items
description: 合集（主题）的有序条目：照片、文字段落、日期分段或记录。
tags: [data, d1, themes, collections]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 建表的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0007_collections.sql
    title: 加入记录条目的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `it_<ulid>`；整体替换条目时重新生成 |
| `theme_id` | TEXT | 非空，外键 → `themes.id`，删除时级联删除 | 所属合集 |
| `position` | INTEGER | 非空 | 顺序，从 0 起 |
| `kind` | TEXT | 非空，默认 `'photo'` | 条目类型：`photo` 照片、`text` 文字段落、`day` 日期分段、`entry` 记录。没有 CHECK：类型会增加（`shared/types.ts` 的 `THEME_ITEM_KINDS`），由 Worker 检查 |
| `photo_id` | TEXT | 可空，外键 → `photos.id`，删除时级联删除 | 仅 `photo` 条目使用 |
| `entry_id` | TEXT | 可空，外键 → `entries.id`，删除时级联删除 | 仅 `entry` 条目使用 |
| `text` | TEXT | 可空 | `photo`、`entry`：本合集里的说明，`photo` 的优先于照片笔记；`text`：段落正文；`day`：当天的说明（可选） |
| `day` | TEXT | 可空 | 仅 `day` 条目使用：日期 `YYYY-MM-DD` |

索引：

- `theme_items_theme`（`theme_id`, `position`）：按顺序读取一个合集的条目。
- `theme_items_photo`（`photo_id`）：照片被删除时级联查找。
- `theme_items_entry`（`entry_id`）：记录被删除时级联查找，记录页列出收录它的合集。

# 关系

- 属于 [themes](/data/themes.md)；合集删除时条目级联删除。
- `photo_id` 引用 [photos](/data/photos.md)，`entry_id` 引用 [entries](/data/entries.md)；照片或记录删除时对应条目一并删除，不留空位。
- 功能说明：[合集](/product/features/themes.md)、[游记](/product/features/travelogue.md)、[照片笔记](/product/features/photo-notes.md)。接口：[合集接口](/api/themes.md)。

# 规则

- 条目只能放合集所有者自己的照片和记录。
- 一张照片、一条记录可以出现在多个合集，也可以在同一个合集里出现多次，表上不限制。
- `position` 不要求唯一；`PUT /api/themes/:id/items` 整体替换时按数组顺序从 0 重新写入。
- 旅程创建时，按拍摄时间排序并在每天第一张照片前插入一个 `day` 条目。
- 记录条目只是引用：记录的标题、正文、照片和公开范围都在记录自己身上，合集里改不了它们，只能写本合集里的说明。

# 隐私

读取合集时，请求者看不到的照片条目，`photo` 为 `null`；打不开的记录条目（仅自己可见、草稿、已归档），`entry` 为 `null`。这些条目留在原位，条目自己的文字仍然返回，前端跳过它们。能打开的记录里，请求者看不到的照片同样略去。

# 迁移

`0007_collections.sql` 加入 `entry_id` 和 `entry` 类型。SQLite 改不了 CHECK，所以重建了这张表：建新表、逐行复制（`id`、`position`、`text` 都不变）、删旧表、改名、重建索引。已有合集的内容和顺序原样保留，见 [数据演进](/data/evolution.md#合集)。
