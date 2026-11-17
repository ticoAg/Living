---
type: API
title: 项目接口
description: 项目的列表、详情、创建、修改与删除，以及里程碑；项目默认仅自己可见，公开的项目也只显示读者能打开的记录和照片。
tags: [api, projects]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/projects.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/projectInput.ts
    title: 输入校验
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# GET /api/projects

`{ "projects": ProjectSummary[] }`，按 `updatedAt` 倒序，最多 500 个。

| 参数 | 返回 |
|---|---|
| （无） | 所有用户的 `public` 项目 |
| `owner=<handle>` | 该用户对请求者可见的项目：他人看到公开的，本人看到全部；用户不存在时为空列表 |
| `mine=1` | 请求者自己的全部项目（需登录） |

项目的状态（进行中、暂停、已完成）不影响可见性。

摘要里的统计只算项目中**已完成、请求者能打开**的记录（本人：自己的全部已完成记录）；草稿和已归档的记录不计。能打开的包括仅链接的记录和照片：项目像合集一样按 id 规则显示内容（见 [可见性](/api/conventions.md#可见性)），列表里的这些数目与项目页上显示的一致。

| 字段 | 含义 |
|---|---|
| `entryCount` | 记录数 |
| `dayCount` | 这些记录发生在多少个不同的日子 |
| `photoCount` | 这些记录里请求者能打开的照片，去重 |
| `lastOccurredAt` | 最近一条的发生时间，没有记录时为 null |
| `cover` | 最近一条带有请求者能打开的照片的记录里，第一张这样的照片；不带笔记 |

缓存同 [接口约定](/api/conventions.md#缓存)。

# GET /api/projects/:id

`ProjectDetail`：摘要的全部字段，加：

- `milestones`：按日期从早到晚，同一天按创建先后。
- `photos`：项目里请求者能打开的记录（本人：自己的全部记录，含草稿和已归档）中，请求者能打开的照片，每张一次，不带笔记，顺序无意义。页面靠它显示记录里的照片，不必取作者的整个图库。

`private` 且非本人 → 404。`unlisted` 凭 id 可以打开。持有这个项目的 [分享链接](/api/shares.md) 时，私密的项目也能打开，`photos`、统计和封面算上作者已完成的私密记录和其中的照片；这样读到的响应带 `Cache-Control: private, no-store`。

项目里的记录用 `GET /api/entries?project=<id>` 取，见 [记录接口](/api/entries.md#get-apientries)。

# POST /api/projects（登录）

`CreateProjectBody` → 201 `{ "project": ProjectDetail }`，id `pj_<ulid>`。

| 字段 | 默认 | 规则 |
|---|---|---|
| `title` | 必填 | 去掉首尾空白，连续空白（含换行）合为一个空格，最多 100 字 |
| `startDate` | 必填 | `YYYY-MM-DD`，作者的本地日期；由浏览器给出 |
| `type` | `other` | `PROJECT_TYPES` 之一：`learning` 学习、`practice` 练习、`reading` 阅读、`creation` 创作、`other` 其他 |
| `description` | null | Markdown，最多 5000 字；规则同记录的正文 |
| `endDate` | null | `YYYY-MM-DD`，计划或实际的最后一天；不能早于 `startDate`；`null` 或空字符串表示不设 |
| `status` | `active` | `active` 进行中、`paused` 暂停、`completed` 已完成 |
| `visibility` | `private` | |

上限定义在 `shared/limits.ts` 的 `PROJECT_LIMITS`。

# PATCH /api/projects/:id（本人）

`UpdateProjectBody` → `{ "project": ProjectDetail }`。只改给出的字段；`title`、`startDate` 不能清空，`description`、`endDate` 给 null 即清空。改完之后结束日期仍不能早于开始日期。给出任一字段就更新 `updatedAt`（值与原来相同也算）；空对象什么也不改。

他人的项目：能打开的返回 403，打不开的返回 404。

# DELETE /api/projects/:id（本人）

→ `{ "ok": true }`。项目、它的里程碑和它与记录的关联一起删除，记录本身不受影响。

# 里程碑

| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| POST | `/api/projects/:id/milestones` | `CreateMilestoneBody` | 201 `{ "milestone": Milestone }`，id `ms_<ulid>` |
| PATCH | `/api/projects/:id/milestones/:milestoneId` | `UpdateMilestoneBody` | `{ "milestone": Milestone }` |
| DELETE | `/api/projects/:id/milestones/:milestoneId` | — | `{ "ok": true }` |

- 只有项目的作者能写；项目的权限规则同上。里程碑不属于这个项目时返回 404。
- `title` 必填（规则同项目名称，最多 100 字），`date` 必填（`YYYY-MM-DD`，到达的日子；还没到的就是计划的日子），`body` 为 Markdown，最多 2 万字，写这一阶段的总结。
- PATCH 只改给出的字段；`title`、`date` 不能清空，`body` 给 null 即清空。
- 一个项目最多 500 个里程碑。
- 增、改、删都会更新项目的 `updatedAt`。

# 记录与项目

- 创建、修改记录时用 `projectIds` 指定它属于哪些项目（最多 50 个，超过或不是数组返回 400），修改时整体替换；只保留自己的项目，其他 id 忽略，见 [记录接口](/api/entries.md)。所以项目里的记录都是项目作者的。
- 记录摘要的 `projectIds` 按项目创建的先后排列，只含请求者能在列表里看到的项目（他人：公开的；本人：全部）：与照片页只列出能公开的合集一样，仅链接的项目不会从记录上被找到。
- 删除项目不改动记录的 `revision`：记录只是不再属于它。
- 个人主页的 `projectCount` 只数请求者能在列表里看到的项目。

数据见 [projects](/data/projects.md)、[entry_projects](/data/entry-projects.md)、[milestones](/data/milestones.md)。
