---
type: D1 Table
title: milestones
description: 项目的里程碑：一个有名字的日子，已经到达或计划中，带这一阶段的总结；里程碑把项目分成阶段。
tags: [data, d1, projects]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0006_projects.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/src/projects/stages.ts
    title: 阶段的划分
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `ms_<ulid>` |
| `project_id` | TEXT | 非空，外键 → `projects.id`，删除时级联删除 | 所属项目 |
| `title` | TEXT | 非空 | 名称，最多 100 字 |
| `body` | TEXT | 可空 | 这一阶段的总结，Markdown，最多 2 万字 |
| `date` | TEXT | 非空 | 到达的日子；还没到的，是计划的日子。`YYYY-MM-DD` |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | |
| `updated_at` | TEXT | 非空，默认当前 UTC 时间 | |

索引：

- `milestones_project`（`project_id`, `date`）：项目页按日期读出全部里程碑。

# 关系

- 属于 [projects](/data/projects.md)，随项目删除；可见性跟随项目，没有自己的公开范围。

# 规则

- 一个项目最多 500 个里程碑；增、删、改都更新项目的 `updated_at`。
- 没有「已达成」的列：日期不晚于今天的就是到达了，晚于今天的是计划。
- 阶段不存，在页面上算出（`src/projects/stages.ts`）：每个到达的里程碑结束一个阶段，包含到它那天为止的已完成记录；最后一个里程碑之后的是正在进行的阶段，项目已完成且之后没有记录时不显示。
