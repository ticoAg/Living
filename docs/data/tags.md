---
type: D1 Table
title: tags
description: 多层级标签树：系统预置标签（owner_id 为空）和用户自己的标签，用 parent_id 组成树。
tags: [data, d1, tags]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | 预置标签用可读的英文 id（如 `lake`，见 [预置标签](/data/preset-tags.md)）；用户标签是 `t_<ulid>` |
| `owner_id` | TEXT | 可空，外键 → `users.id`，删除时级联删除 | 所有者；空表示系统预置，所有人可见 |
| `parent_id` | TEXT | 可空，外键 → `tags.id`，删除时级联删除 | 父标签；空表示根 |
| `name` | TEXT | 非空 | 显示名，1–24 字符 |
| `color` | TEXT | 可空 | 十六进制色值，或 `mono`（黑白色块）；只有色调类标签用 |
| `sort` | INTEGER | 非空，默认 `0` | 同级排序，小的在前；新建标签取同级最大值加 10 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |

索引：

- `tags_parent`（`parent_id`）：取子节点、递归取子孙。
- `tags_owner`（`owner_id`）：取某个用户的标签。

# 关系

- 自引用：`parent_id` 组成树，层级不限；删除一个标签会级联删除它的全部子孙。
- [photo_tags](/data/photo-tags.md) 通过 `tag_id` 关联到 [photos](/data/photos.md)；标签被删除时关联行一并删除。
- `owner_id` 指向 [users](/data/users.md)；用户被删除时，其标签（以及挂在这些标签下的子孙）一并删除。
- 功能说明：[多层级标签](/product/features/hierarchical-tags.md)。接口：[标签接口](/api/tags.md)。

# 规则

- 用户可以在任意节点（预置的或自己的）下加子标签，也可以建自己的根。预置标签只有站长和管理员能改。
- 重名检查由接口完成，表上没有唯一约束：同一父节点下，自己的标签不能重名，也不能与该父节点下的预置标签同名（409）。
- 移动标签时，新父节点不能是自己或自己的子孙（400）。
- 照片只直接记录它带的标签，不展开祖先；筛选"选中父标签等于选中全部子孙"和包含子孙的计数在客户端计算（`src/lib/tags.ts`）。

# 隐私

- 用户的标签对所有人可见（`GET /api/tags?owner=<handle>`），即使只有私密照片用到它。标签名不要写敏感信息。
- `Tag.count` 只统计对请求者可见的照片。

# Examples

```sql
-- 某个标签及其全部子孙，用于父标签筛选或删除
WITH RECURSIVE sub(id) AS (
  SELECT 'nature'
  UNION ALL
  SELECT t.id FROM tags t JOIN sub ON t.parent_id = sub.id
)
SELECT id FROM sub;
```
