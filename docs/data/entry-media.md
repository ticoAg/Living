---
type: D1 Table
title: entry_media
description: 记录与照片的多对多关联，带顺序和记录内的说明；照片只被引用，不被复制。
tags: [data, d1, entries, photos]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `entry_id` | TEXT | 非空，外键 → `entries.id`，删除时级联删除 | 记录 |
| `photo_id` | TEXT | 非空，外键 → `photos.id`，删除时级联删除 | 照片 |
| `position` | INTEGER | 非空 | 在记录里的顺序，从 0 起 |
| `caption` | TEXT | 可空 | 这张照片在这条记录里的说明，最多 2000 字；不改变照片自己的笔记 |

主键（`entry_id`, `photo_id`）：同一张照片在一条记录里只出现一次。

索引：

- `entry_media_photo`（`photo_id`）：照片页列出「所属记录」，照片删除时查找引用它的记录。

# 关系

- [entries](/data/entries.md) 与 [photos](/data/photos.md) 之间的多对多：一条记录可以有很多照片，一张照片可以出现在很多记录里，也可以同时在 [合集](/data/theme-items.md) 里。
- 名字叫 media 而不叫 photos：照片是第一种媒体，以后的视频、录音和文件也经这里关联，见 [演进](/data/evolution.md)。

# 可见性

照片自己的 `visibility` 说了算，记录不改变它：

- 他人看一条记录时，只看到他们按 id 能打开的照片（`public`、`unlisted`，见 [接口约定](/api/conventions.md#可见性)），私密照片从 `photoIds` 和 `media` 里略去，顺序不变。
- 照片页的「所属记录」只列请求者能在列表里看到的记录（他人：公开且已完成）。

# 规则

- 只能放作者自己的照片；别人的或不存在的照片整条请求按 400 拒绝。
- 修改照片时整体替换：先删后按数组顺序从 0 重新写入；数组里重复的照片只保留第一次出现。
- 删除照片时，Worker 在同一批语句里把引用它的记录 `revision` 加一、更新 `updated_at`，再删除这里的行，让打开着的编辑器发现变化。
- 删除记录不删除照片。
