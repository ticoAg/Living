---
type: D1 Table
title: projects
description: 项目：一个持续的过程，如学书法、一年读书计划；有类型、起止日期、状态和公开范围，聚合作者自己的记录和里程碑。
tags: [data, d1, projects]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0006_projects.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
  - resource: https://github.com/ticoAg/Living/blob/main/shared/projects.ts
    title: 类型名与状态名
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `pj_<ulid>` |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 作者 |
| `type` | TEXT | 非空，默认 `'other'` | `learning` 学习、`practice` 练习、`reading` 阅读、`creation` 创作、`other` 其他；不设 CHECK，见 [规则](#规则) |
| `title` | TEXT | 非空 | 名称，最多 100 字 |
| `description` | TEXT | 可空 | 目标和计划，Markdown，最多 5000 字 |
| `start_date` | TEXT | 非空 | 开始的日子，作者的本地日期 `YYYY-MM-DD` |
| `end_date` | TEXT | 可空 | 计划或实际的最后一天；不能早于 `start_date` |
| `status` | TEXT | 非空，默认 `'active'`，取值 `active` `paused` `completed` | 进行中、暂停、已完成 |
| `visibility` | TEXT | 非空，默认 `'private'`，取值 `public` `unlisted` `private` | 公开范围 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | |
| `updated_at` | TEXT | 非空，默认当前 UTC 时间 | 最近一次修改，包括里程碑的增删改；记录的加入和移出不算 |

索引：

- `projects_owner`（`owner_id`）：作者自己的项目（`?mine=1`）和个人主页。

# 关系

- 作者 [users](/data/users.md)，删除用户时项目级联删除。
- 记录在 [entry_projects](/data/entry-projects.md)，里程碑在 [milestones](/data/milestones.md)；删除项目时这两处的行级联删除，记录本身不受影响。
- 功能说明：[项目](/product/features/projects.md)；接口：[项目接口](/api/projects.md)。

# 可见性

与主题相同：他人看到 `public` 的列表与详情、凭链接打开 `unlisted` 的，`private` 的按 404 处理。SQL 条件在 `worker/lib/visibility.ts` 的 `projectList`（列表与计数）和 `projectById`（详情）。

项目的公开范围不改变其中记录和照片的公开范围：项目页和项目的统计只用请求者凭 id 能打开的记录（已完成、公开或仅链接）和照片，其余直接略去，见 [可见性](/api/conventions.md#可见性)。状态不影响可见性。

# 规则

- 新项目默认 `private`、`active`。
- 统计（记录数、天数、照片数、最近一条）和封面不存，每次读取时从 [entry_projects](/data/entry-projects.md) 和记录算出：只算已完成的记录，按请求者能打开的过滤，存下来就得按读者分别存。
- `type` 的取值会增加，表上不设 CHECK，Worker 按 `shared/types.ts` 的 `PROJECT_TYPES` 校验；读到不认识的值时界面按「其他」显示。项目的类型决定从项目页新写的记录默认是什么类型（学习、练习 → 练习，阅读 → 阅读，创作 → 创作，其他 → 随记），见 `shared/projects.ts` 的 `entryTypeFor`。
- 「第 N 天」从 `start_date` 数起，开始那天是第 1 天；已完成的项目数到 `end_date`，没有就数到最后一条记录。
