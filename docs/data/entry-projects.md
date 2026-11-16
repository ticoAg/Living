---
type: D1 Table
title: entry_projects
description: 记录与项目的多对多关联；一条记录可以属于几个项目，也可以不属于任何项目。
tags: [data, d1, entries, projects]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0006_projects.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `entry_id` | TEXT | 非空，外键 → `entries.id`，删除时级联删除 | 记录 |
| `project_id` | TEXT | 非空，外键 → `projects.id`，删除时级联删除 | 项目 |

主键（`entry_id`, `project_id`）。

索引：

- `entry_projects_project`（`project_id`）：项目里的记录（`GET /api/entries?project=`）、项目的统计和封面。

# 关系

- [entries](/data/entries.md) 与 [projects](/data/projects.md) 之间的多对多。没有顺序列：项目里的记录按发生时间排列，记录上的项目按项目创建的先后。

# 规则

- 只能放进作者自己的项目；其他 id（别人的、已删除的）被忽略，不报错。所以一个项目里只有它的作者的记录。
- 在记录上整体替换（`projectIds`），一条记录最多属于 50 个项目。
- 删除项目只删这里的行，记录本身和它的 `revision` 不变；删除记录时这里的行同样删除。
- 可见性两个方向不同：项目页按 [entries 的规则](/data/entries.md#可见性) 显示他人凭链接能打开的记录；记录上的 `projectIds` 只列出他人能在列表里看到的（公开的）项目，仅链接的项目不会从记录上被找到。
