---
type: Data Plan
title: 数据演进
description: 从照片为中心走向记录为中心的数据计划：项目与合集的表、主题如何原地成为合集、照片的默认可见性，以及迁移必须遵守的规则。
tags: [data, planning, entries, themes]
status: draft
sources:
  - resource: https://github.com/ticoAg/Living/issues/47
    title: 产品方向调整（Issue #47）
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 第一阶段的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0006_projects.sql
    title: 第二阶段的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0007_collections.sql
    title: 第三阶段的迁移
---
# 阶段

| 阶段 | 数据 | 状态 |
|---|---|---|
| 一：记录 | [entries](/data/entries.md)、[entry_media](/data/entry-media.md)、[entry_tags](/data/entry-tags.md) | 已建（`0005_entries.sql`） |
| 二：项目 | [projects](/data/projects.md)、[entry_projects](/data/entry-projects.md)、[milestones](/data/milestones.md) | 已建（`0006_projects.sql`），见 [项目](#项目) |
| 三：合集与媒体 | 合集（[themes](/data/themes.md) 原地演进，[theme_items](/data/theme-items.md) 加入记录条目）、[users](/data/users.md) 的新照片默认公开范围 | 已建（`0007_collections.sql`），见 [合集](#合集)、[照片的默认可见性](#照片的默认可见性)；记录与地点、分享链接、新媒体还是计划 |
| 四：完整档案 | 全文索引、导出 | 计划 |

产品上的边界见 [内容模型](/product/content-model.md)，分阶段的范围见 [路线图](/product/roadmap.md)。

# 迁移的规则

- **只加不改**：新表、新列；不改写已有行的含义。
- **不改可见性**：任何迁移都不改变已有照片、合集的 `visibility`、`geo_privacy`。已经分享出去的内容保持原样，隐私上的收紧由作者在界面里自己做。
- **旧地址不断**：`/t/:id`、`/p/:id` 及其接口在新模型上线后照常可用。
- **重建表时逐行照搬**：SQLite 改不了 CHECK 等约束，非改不可时建新表、复制每一行（id 不变）、换名；行的含义不变。
- **不替作者写记录**：照片笔记、合集里的文字段落不自动变成记录。需要时提供「转为记录」这样由作者发起的动作。

# 项目

第二阶段，已建。项目描述一个持续的过程（学书法、一年读书计划），聚合作者自己的记录和里程碑；不强制每条记录都属于项目。表见 [projects](/data/projects.md)、[entry_projects](/data/entry-projects.md)、[milestones](/data/milestones.md)。与草案不同的地方：

- 里程碑只有一个日期 `date`（`YYYY-MM-DD`），不带时刻，也没有 `position`：按日期排列，日期晚于今天的就是计划中的。
- 项目自己不存照片：项目页的作品来自其中记录的照片，统计和封面每次读取时算出。

可见性：项目公开不公开其中的私密记录；项目页和统计按 [entries 的规则](/data/entries.md#可见性) 逐条过滤，与合集显示仅链接的照片一样，显示凭链接能打开的记录。

# 合集

第三阶段，已建。[themes](/data/themes.md) 和 [theme_items](/data/theme-items.md) 本来就是「有顺序、有标题、有导语的精选」，合集就在它们身上原地演进，没有搬到新表：

| 原来的主题 | 现在的合集 |
|---|---|
| 界面叫「主题」 | 界面叫「合集」；表、接口、代码沿用 themes，`/themes`、`/t/:id` 不变 |
| 条目：照片、文字段落、日期分段 | 加一种记录条目（`kind = 'entry'`，`theme_items.entry_id`），与其他条目混排 |
| `kind = topic`（专题） | 专题合集 |
| `kind = trip`（旅程） | 旅程合集：保留按天分段、路线图和游记视图，也能放记录；没有变成项目 |
| 条目里的照片说明（`theme_items.text`） | 原样保留；记录条目也有一段本合集里的说明 |
| 文字段落 | 原样保留，不自动转为记录 |
| 默认 `private` | 不变；已有合集的公开范围不动 |

旅程为什么不变成项目：旅程是一次已经发生的旅行的编排，有日期和路线，读者按顺序读；项目是一个还在继续的过程，按里程碑分阶段。一次旅行可以同时有一个旅程合集（给人看的游记）和几条旅行类记录（`type = trip`），合集把这些记录收进来即可。将来要「项目的精选」时，同样是一个收录项目记录的合集。

可见性：与项目一样，合集公开不公开其中的私密内容。照片条目按照片的规则，记录条目按 [entries 的规则](/data/entries.md#可见性)（读者凭链接能打开的才显示），记录里的照片再按照片的规则；合集的照片数、记录数、封面、路线和地点都只算读者能看到的。

迁移：`0007_collections.sql` 重建了 theme_items（见上面的规则），每一行原样复制，已有合集的内容和顺序不变。

# 照片的默认可见性

第三阶段，已建：[users](/data/users.md#新照片的默认公开范围) 的 `photo_visibility`。

- 新账号默认 `private`，与记录、项目、合集一致。
- 已有账号设为 `public`，上传行为不变，直到本人在设置里修改。没有直接把所有人改成 `private`：访客看到的图库、地图、索引和 Living 都由公开照片组成，悄悄改掉正在用的上传流程，照片发出去了却不再出现在图库里。
- 上传页把每张新照片预先设成这个值，顶部写着当前的默认值，链到设置；接口收到没有公开范围的上传时也按它保存。
- 迁移不改任何照片的公开范围；已有照片的隐私由作者自己检查、修改。

# 媒体

[photos](/data/photos.md) 继续作为媒体层，图片处理不重写。[entry_media](/data/entry-media.md) 的名字已经为视频、录音、文件留了位置：增加新媒体时，或给 `photos` 加 `kind`，或另建表并让关联表带上媒体类型，到时再按实际需要定。原图仍只对本人开放，私密附件的文件、缩略图和计数都按同一套权限过滤。

# 导出与备份

第四阶段：完整导出为 Markdown（每条记录一个文件，带 frontmatter）、JSON（全部元数据）和原始媒体文件；说明 D1 与 R2 的备份和恢复流程。Cloudflare 托管的存储不等于本地自托管，产品说明里要写清楚。
