---
type: Data Plan
title: 数据演进
description: 从照片为中心走向记录为中心的数据计划：项目与合集的表、旧主题的兼容方式、照片的默认可见性，以及迁移必须遵守的规则。
tags: [data, planning, entries, themes]
status: draft
sources:
  - resource: https://github.com/ticoAg/Living/issues/47
    title: 产品方向调整（Issue #47）
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 第一阶段的迁移
---
# 阶段

| 阶段 | 数据 | 状态 |
|---|---|---|
| 一：记录 | [entries](/data/entries.md)、[entry_media](/data/entry-media.md)、[entry_tags](/data/entry-tags.md) | 已建（`0005_entries.sql`） |
| 二：项目 | `projects`、`entry_projects`、`milestones` | 计划，见 [项目](#项目) |
| 三：合集与媒体 | 合集（由 [themes](/data/themes.md) 演进）、记录与地点 | 计划，见 [主题](#主题) |
| 四：完整档案 | 全文索引、导出 | 计划 |

产品上的边界见 [内容模型](/product/content-model.md)，分阶段的范围见 [路线图](/product/roadmap.md)。

# 迁移的规则

- **只加不改**：新表、新列；不改写已有行的含义。
- **不改可见性**：任何迁移都不改变已有照片、主题的 `visibility`、`geo_privacy`。已经分享出去的内容保持原样，隐私上的收紧由作者在界面里自己做。
- **旧地址不断**：`/t/:id`、`/p/:id` 及其接口在新模型上线后照常可用。
- **不替作者写记录**：照片笔记、主题里的文字段落不自动变成记录。需要时提供「转为记录」这样由作者发起的动作。

# 项目

第二阶段。项目描述一个持续的过程（学书法、一年读书计划），可以聚合记录、媒体和里程碑；不强制每条记录都属于项目。

| 表 | 列（草案） |
|---|---|
| `projects` | `id`（`pj_`）、`owner_id`、`title`、`description`（目标）、`type`、`start_date`、`end_date`、`status`（`active` `paused` `completed`）、`visibility`（默认 `private`）、`created_at`、`updated_at` |
| `entry_projects` | `entry_id`、`project_id`，主键两列；删除项目不删除记录 |
| `milestones` | `id`、`project_id`、`title`、`body`、`occurred_at`、`position` |

可见性：项目公开不公开其中的私密记录；项目页的时间线按 [entries 的规则](/data/entries.md#可见性) 逐条过滤。

# 主题

现有的 [themes](/data/themes.md) 和 [theme_items](/data/theme-items.md) 已经是一个「有顺序、有标题、有导语的精选」，是合集最接近的前身。计划是让它原地演进，而不是搬到新表：

| 现在 | 第三阶段 |
|---|---|
| `kind = topic`（专题） | 成为合集：同一张表、同一个 `/t/:id`，条目里增加一种「记录」条目（`theme_items.entry_id`），与照片、文字、分段并列 |
| `kind = trip`（旅程） | 不机械地变成项目：旅程是一次已经发生的旅行的编排，有日期和路线，更像「旅程合集」。保留现有的按天分段、路线图和游记视图，单独评估它与旅行类记录（`type = trip`）、将来的项目之间的引用方式 |
| 条目里的照片说明（`theme_items.text`） | 原样保留，仍是本主题内的说明 |
| 文字段落条目 | 原样保留；作者可以把它转为记录，不自动转换 |
| 默认 `private` | 不变；已有主题的公开范围不动 |

在此之前，主题的接口与页面不变，[记录](/data/entries.md) 和主题各自独立。

# 照片的默认可见性

新上传的照片现在默认 `public`（主题、记录默认 `private`）。方向上应当评估改为 `private`，但第一阶段不改：

- 访客看到的图库、地图、索引和 Living 都由公开照片组成，改默认值会悄悄改变正在用的上传流程：照片发出去了，却不再出现在图库里。
- 改之前要在上传页明确提示当前的默认值和它的后果，并先做一次已有内容的隐私检查。
- 倾向的做法：在设置里加「新照片默认公开范围」，新账号默认 `private`，已有账号保持现在的行为直到自己更改；上传页显示当前默认值。放在第三阶段，与媒体层的整理一起做。

# 媒体

[photos](/data/photos.md) 继续作为媒体层，图片处理不重写。[entry_media](/data/entry-media.md) 的名字已经为视频、录音、文件留了位置：增加新媒体时，或给 `photos` 加 `kind`，或另建表并让关联表带上媒体类型，到时再按实际需要定。原图仍只对本人开放，私密附件的文件、缩略图和计数都按同一套权限过滤。

# 导出与备份

第四阶段：完整导出为 Markdown（每条记录一个文件，带 frontmatter）、JSON（全部元数据）和原始媒体文件；说明 D1 与 R2 的备份和恢复流程。Cloudflare 托管的存储不等于本地自托管，产品说明里要写清楚。
