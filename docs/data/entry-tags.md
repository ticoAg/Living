---
type: D1 Table
title: entry_tags
description: 记录与标签的多对多关联；与照片共用一棵标签树，但分开挂。
tags: [data, d1, entries, tags]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `entry_id` | TEXT | 非空，外键 → `entries.id`，删除时级联删除 | 记录 |
| `tag_id` | TEXT | 非空，外键 → `tags.id`，删除时级联删除 | 标签 |

主键（`entry_id`, `tag_id`）。

索引：

- `entry_tags_tag`（`tag_id`）：按标签筛选、统计标签下的记录数、删除标签。

# 关系

- [entries](/data/entries.md) 与 [tags](/data/tags.md) 之间的多对多。
- 和 [photo_tags](/data/photo-tags.md) 用同一棵标签树，但互不影响：给记录打「书法」不会给它的照片打，反之亦然。照片标签仍描述画面（湖、晨光、秋），记录标签描述这件事。

# 规则

- 只能用预置标签和作者自己的标签；其他 id 被忽略，不报错（与照片相同）。
- 修改时整体替换。
- 删除标签（连同子孙）时，Worker 在同一批语句里删除这里对应的行，与 `photo_tags` 一起。标签接口返回的 `entryCount` 让管理标签时看得到会影响几条记录。
- 没有 `source` 列：记录的标签都是作者手动打的。
