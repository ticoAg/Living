---
type: D1 Table
title: photo_tags
description: 照片与标签的多对多关联，区分手动选择和系统建议。
tags: [data, d1, tags, photos]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `photo_id` | TEXT | 非空，主键（与 `tag_id` 联合），外键 → `photos.id`，删除时级联删除 | 照片 |
| `tag_id` | TEXT | 非空，主键（与 `photo_id` 联合），外键 → `tags.id`，删除时级联删除 | 标签 |
| `source` | TEXT | 非空，默认 `'manual'`，取值 `manual` `suggested` | 来源：用户选择，或上传时系统建议 |

索引：

- `photo_tags_tag`（`tag_id`）：按标签找照片。按照片找标签走主键。

# 关系

- 连接 [photos](/data/photos.md) 和 [tags](/data/tags.md)；任一端删除，关联行级联删除。
- 功能说明：[多层级标签](/product/features/hierarchical-tags.md)、[上传与整理](/product/features/upload.md)。接口：[照片接口](/api/photos.md)、[标签接口](/api/tags.md)。

# 规则

- 只记录照片直接带的标签，不展开祖先。选中父标签时包含全部子孙，由 `src/lib/tags.ts` 在客户端展开。
- 上传时，用户选择的标签记为 `manual`，系统建议的（默认选中、可取消）记为 `suggested`。
- 修改照片时 `tagIds` 整体替换，之后所有关联都记为 `manual`。
- 只接受预置标签和照片所有者自己的标签。

# 隐私

关联行没有独立的可见性：能否看到取决于照片的 [可见性](/data/photos.md#可见性与隐私)。标签的 `count` 只统计对请求者可见的照片。
