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
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0008_shares_places.sql
    title: 第三阶段的迁移：分享链接与记录的地点
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0009_search.sql
    title: 第四阶段的迁移：搜索的部分索引
---
# 阶段

| 阶段 | 数据 | 状态 |
|---|---|---|
| 一：记录 | [entries](/data/entries.md)、[entry_media](/data/entry-media.md)、[entry_tags](/data/entry-tags.md) | 已建（`0005_entries.sql`） |
| 二：项目 | [projects](/data/projects.md)、[entry_projects](/data/entry-projects.md)、[milestones](/data/milestones.md) | 已建（`0006_projects.sql`），见 [项目](#项目) |
| 三：合集与媒体 | 合集（[themes](/data/themes.md) 原地演进，[theme_items](/data/theme-items.md) 加入记录条目）、[users](/data/users.md) 的新照片默认公开范围、[share_links](/data/share-links.md)、[entries](/data/entries.md) 的地点 | 已建（`0007_collections.sql`、`0008_shares_places.sql`），见 [合集](#合集)、[照片的默认可见性](#照片的默认可见性)、[分享链接](#分享链接)、[记录的地点](#记录的地点)；新媒体按需要再加，见 [媒体](#媒体) |
| 四：完整档案 | 搜索用的部分索引 `photos_owner_text`（[photos](/data/photos.md#索引)）；导出、日历、回顾、作品与文章不加表 | 搜索与导出已做（`0009_search.sql`），见 [搜索](#搜索)、[导出与备份](#导出与备份)；日历、年度回顾和项目的节奏已做，见 [日历与回顾](#日历与回顾)；作品与文章已做，见 [作品与文章](#作品与文章) |

产品上的边界见 [内容模型](/product/content-model.md)，分阶段的范围见 [路线图](/product/roadmap.md)。

# 迁移的规则

- **只加不改**：新表、新列；不改写已有行的含义。
- **不改可见性**：任何迁移都不改变已有照片、合集的 `visibility`、`geo_privacy`。已经分享出去的内容保持原样，隐私上的收紧由作者在界面里自己做。分享链接也不是迁移放开的：只有作者自己建了，才有人能凭它看到私密内容。
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

# 分享链接

第三阶段，已建：[share_links](/data/share-links.md)。仅链接（`unlisted`）的地址一旦发出就收不回，除非改公开范围，那样所有拿到地址的人一起失去；分享链接补上「只给这几个人看，随时收回，到期自动失效」。

- 一个链接指向一条记录、一个合集或一个项目；一项可以有几个链接，分别删除。
- 打开的人能看到这一项和其中显示的内容，不管它们各自的公开范围；草稿、已归档的记录和原图除外，位置精度照旧。到达范围见 [分享链接接口](/api/shares.md#能看到什么)。
- 授权不写进内容的行里，也不改任何 `visibility`：读取时按请求带来的链接临时放宽，规则在 `worker/lib/shares.ts` 和 `worker/lib/visibility.ts` 的 `grant` 参数。删掉链接、链接过期，下一个请求就打不开。
- 列表、主页、图库、地图和搜索不看分享链接：它们照旧只显示公开的内容。

# 记录的地点

第三阶段，已建：[entries](/data/entries.md#地点) 的 `poi_id`，复用全站共享的 [pois](/data/pois.md)。

- 一条记录最多一个地点，可以不选；与照片的地点相互独立，记录的照片在哪里不决定记录在哪里。
- 记录没有位置精度：能看到记录的人都能看到地点的名称和城市。地点落在作者的隐私区域内时，编辑器提醒，不自动隐藏，因为地点是作者亲手选的。
- 地点页列出在这里的记录。[地图的记录图层](/product/features/map.md#记录图层) 把记录放在它的地点；没有地点的，只在地图上借它某张照片的位置显示，记录本身仍然没有地点。照片的位置照旧按位置精度，所以记录不会把隐藏了位置的照片带上地图。不加表和索引：`located=1` 只是列表多一个条件。

# 媒体

[photos](/data/photos.md) 继续作为媒体层，图片处理不重写。[entry_media](/data/entry-media.md) 的名字已经为视频、录音、文件留了位置：增加新媒体时，或给 `photos` 加 `kind`，或另建表并让关联表带上媒体类型，到时再按实际需要定。原图仍只对本人开放，私密附件的文件、缩略图和计数都按同一套权限过滤。

# 搜索

[搜索](/api/search.md) 只搜登录者自己的行，用 `LIKE '%词%'` 直接查表，不建 FTS5 全文索引：

- D1 标准的导出不支持虚拟表；带虚拟表的导出（`--compatibility sqlite3_cli_only`）只能给 SQLite 命令行用，导不回 D1。有了 FTS5，[备份](/runbooks/backup.md) 就得先删掉索引再导出、导出后重建。
- 中文没有空格，两个字（西湖、书法）就是一个词，FTS5 的分词器都帮不上：默认的把一整句当成一个词，trigram 至少要三个字才用得上索引；`LIKE` 本来就是按字找。
- 一个人的档案在几千到几万行之间，按 `owner_id` 读一遍的行数在免费额度（每天 500 万行）里很宽裕。照片多，所以 `0009_search.sql` 加了部分索引 `photos_owner_text`，只收有标题或笔记的照片。

记录多到搜索明显变慢、或读取行数成了问题时，再考虑全文索引（以及相应的备份流程）。

# 日历与回顾

不加表，也不加索引：[日历](/product/features/calendar.md) 按月读列表（记录和照片列表的 `from`、`to`），[回顾](/api/review.md) 在一个 `db.batch` 里按年汇总，日期范围都落在已有的 `entries_owner_occurred (owner_id, occurred_at)` 和 `photos_owner_taken (owner_id, taken_at)` 上。

- 日期都是本地钟表时间的字符串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:MM:SS`），按字典序比较即按时间比较。一段日期的上界写成 `<最后一天>~`：`~` 排在数字和 `T` 之后，这一天的所有值（只有日期的、带时刻的）都在它前面，下一天在它后面，不用推算下一天，也不会在 9999 年越界（`shared/days.ts` 的 `endOfDay`）。
- 汇总在服务器上算，不在浏览器里从列表算：列表各有 5000 条的上限，早年的内容会被截掉。
- 项目的节奏在浏览器里算：项目页本来就读了项目的全部记录。

# 作品与文章

不加表，也不加列：[作品与文章](/product/features/showcase.md) 就是类型为 `creation`、`article` 的已完成记录，公开与否仍是记录自己的 `visibility`。

- 记录列表加上 `type=` 筛选，作品页和文章页只读这一种类型的记录；列表摘要加上 `chars`（`length(body)`，正文的码点数），文章的字数不用读出整个正文。
- 不另设「精选」或展示顺序的字段：先按发生时间从新到旧，真有需要再加。
- 访客视角是前端的事：同样的接口，请求不带 Cookie，见 [前端分区](/architecture/frontend.md#访客视角)。

# 导出与备份

- **导出**（[导出接口](/api/export.md)）：不加表。Worker 按页读出登录者自己的行，浏览器拼成 Markdown、living.json 和原文件。导出的格式有版本号（`living-export` 第 1 版），字段改动时升版本，旧版本的字段说明留在文档里。
- **备份**：站长用 `wrangler d1 export` 导出整个 D1，用 rclone 复制 R2 的桶；恢复先导入新库、核对后再换上，见 [备份与恢复](/runbooks/backup.md)。
- Cloudflare 托管的存储不等于本地自托管：数据在站长的 Cloudflare 账号里，个人的导出和站长的备份才是在自己手里的副本，产品说明（[愿景](/product/vision.md)、[导出](/product/features/export.md#隐私)）里写明了。
- **导入**（[导入接口](/api/import.md)）：不加表，也不加列。认出「以前导入过」靠 id 本身：新的记录、项目、合集和自建地点的 id 是账号 id 和导出里的 id 的 SHA-256（`importedId`，[worker/lib/ids.ts](https://github.com/ticoAg/Living/blob/main/worker/lib/ids.ts)），同一个账号再导入得到同一个 id，别的账号和普通的新建到不了它。照片照旧按 `photos_owner_sha` 认重复，标签按上级标签下的名字，地图服务的地点按 `source`、`source_id`。导出的格式升版本时，导入要能读旧版本。
