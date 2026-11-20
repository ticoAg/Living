---
type: Roadmap
title: 路线图
description: 影像图库已经可用；正在分阶段演进为以记录为中心的个人数字档案：记录、项目、合集与媒体（含地图的记录图层、附件、媒体库，图库和 Living 的记录）已完成，完整档案（搜索、导出、备份与恢复、日历与年度回顾、项目的节奏、作品与文章的展示、导入已完成）进行中。
tags: [product, planning]
sources:
  - resource: https://github.com/ticoAg/Living/issues/47
    title: 产品方向调整（Issue #47）
---
# 已交付：影像图库

一个人能从上传走到发布游记，访客能顺畅浏览。

- [账号](/product/features/accounts.md)：邀请码注册、登录、个人主页
- [上传与整理](/product/features/upload.md) 和 [地点匹配](/product/features/poi-matching.md)
- [多层级标签](/product/features/hierarchical-tags.md)：预置 + 自定义
- [照片笔记](/product/features/photo-notes.md)
- 主题（现在的 [合集](/product/features/themes.md)）和 [游记](/product/features/travelogue.md)
- [图库](/product/features/gallery.md)、[照片详情](/product/features/photo-detail.md)、[地点页](/product/features/places.md)、[地图](/product/features/map.md)、[索引](/product/features/index-page.md)
- [Living 模式](/product/features/living-mode.md)
- [隐私](/product/features/privacy.md) 和 [站点管理](/product/features/admin.md)

# 以记录为中心

方向见 [Issue #47](https://github.com/ticoAg/Living/issues/47) 和 [决策：以记录为中心](/architecture/decisions/0007-entry-first.md)。增量演进：现有页面、接口和链接一直可用。

## 阶段零：产品与数据设计（已完成）

- [内容模型](/product/content-model.md)：记录、媒体、项目、合集的边界与关系；记录的类型、时间、状态和可见性。
- [数据演进](/data/evolution.md)：项目与合集的表、主题如何成为合集、迁移规则、照片默认可见性的评估。
- 新内容默认仅自己可见的规则，见 [隐私](/product/features/privacy.md#记录)。

## 阶段一：记录成为一等公民（已完成）

- [记录](/product/features/entries.md)：可以只有文字；Markdown 正文、自动保存与草稿；关联自己的照片并写说明；标签；默认仅自己可见。
- [今天](/product/features/today.md)：随手记、今天的记录与照片、草稿、往年今天。
- [档案](/product/features/archive.md)：记录与照片按发生时间排成一条时间线，按类型、标签筛选，按年份跳转。
- 登录后的导航改为 今天、档案、图库（照片、地图、索引）、主题（第三阶段改称合集）。

验收：不上传照片、不选合集或项目，就能快速记下一条私密记录；之后补上标题、正文、日期、标签和照片；在时间线里找得到。

## 阶段二：项目与成长档案（已完成）

- [项目](/product/features/projects.md)：名称、目标、类型、起止日期、状态（进行中、暂停、已完成），默认仅自己可见；在档案下与时间线并列，「今天」列出进行中的项目。
- 项目页：天数和统计、最初与最近的作品并排、按里程碑分出的阶段（作品和阶段总结）、项目内的记录。
- 记录在编辑器里选择所属的项目，可以不选；从项目页记一笔时预先选好，类型按项目定。

验收：建一个「从零开始学书法」，每次练习记一笔并带上作品照片，在项目页看练习时间线和阶段成果。

## 阶段三：合集、媒体和旧功能整合（已完成）

已完成：

- [合集](/product/features/themes.md)：主题原地成为合集，界面改称合集；条目里可以放 [记录](/product/features/entries.md)，与照片、文字段落、日期分段混排。旅程仍是旅程（按天分段、路线、游记），没有变成项目，理由见 [数据演进](/data/evolution.md#合集)。旧的 `/t/:id`、游记内容和顺序保留。
- 阅读页、路线、途经地点、照片数和封面都算上记录里的照片；Living 按合集播放时也放记录里的照片。记录页列出收录它的合集。
- 新照片的默认公开范围可以在设置里选；新账号是仅自己，已有账号保持公开直到自己修改；上传页显示当前默认值，见 [隐私](/product/features/privacy.md#新照片)。
- [分享链接](/product/features/sharing.md)：为一条记录、一个合集或一个项目生成私密链接，拿到的人不用登录就能看，包括其中仅自己可见的内容；随时可以删除，可设 1 天、7 天、30 天的有效期；设置里统一管理。
- 记录可选一个 [地点](/product/features/entries.md#写)：先列出照片所在的地点，也能按名称搜索；记录页和卡片上显示，地点页列出在这里的记录。
- 地图从记录出发：[地图](/product/features/map.md#记录图层) 切到记录图层，公开的记录按它的地点（没有地点时按照片的位置）合成图集，侧栏列出记录卡片，按类型筛选。
- [附件](/product/features/attachments.md)：记录里可以放视频、录音和其他文件，编辑器和随手记里直接录音；阅读页里播放，其他文件下载；跟着记录的公开范围，上传前抹掉视频里的拍摄地点；导出、导入和搜索都带上附件。
- [媒体库](/product/features/library.md)：图库的第四个标签页，自己的照片、视频、音频和文件各有多少、多大，哪些不在任何记录里，不在记录里的附件几天后删去；选几样写成一条记录。
- 图库和 Living 也从记录出发：首页切到 [记录](/product/features/gallery.md#记录) 看所有人公开的记录，按类型筛选；[Living](/product/features/living-mode.md#记录) 能放一条记录或一批记录里的照片，字幕写着照片所在的记录。

验收：把几条练字记录和几张作品照片放进「我的书法作品」，公开后访客只看到公开的那些，计数和封面也只算这些；旧的旅程游记照常打开，顺序不变；在随手记里录一段练琴的声音记下，在记录里放一段手机拍的视频，公开后访客能播放，改回仅自己后访客打不开；在媒体库里找到上周传了却没放进记录的视频，选上它写一条记录；访客在首页切到记录，只看「练习」，点 Living 放这些练习里的照片。

## 阶段四：完整个人档案（进行中）

已完成：

- [搜索](/product/features/search.md)：在自己的档案里找字，记录、照片、项目、合集、地点和标签分组列出，片段里标出找到的字；按 `/` 随时打开。只搜自己的内容，不建全文索引，理由见 [数据演进](/data/evolution.md#搜索)。
- [导出](/product/features/export.md)：Markdown（记录、项目、合集各一个文件，带 frontmatter）、living.json（全部信息）、照片原文件和附件；下载为 zip，或在 Chrome、Edge 里导出到一个文件夹，再次导出只下载新的照片和附件。
- [备份与恢复](/runbooks/backup.md)：站长把 D1 导出成 SQL、把 R2 复制到自己的硬盘，恢复时先导入新库再换上；[愿景](/product/vision.md) 和导出的说明里写明托管存储不等于本地自托管。
- [日历与年度回顾](/product/features/calendar.md)：档案里的日历一个月一张表，选一天看全部、补记空着的日子；一年一页回顾记录和照片的数量、每一天的疏密、收藏、项目、合集、地点和标签。
- 项目的 [节奏](/product/features/projects.md#节奏)：最长和现在连续几天、平均每周几天、最近六个月每天的小月历，长的项目再加每个月的记录数。
- [作品与文章](/product/features/showcase.md)：个人主页最先展示已完成的「创作」和「文章」，各有一页列出全部（`/@handle/works`、`/@handle/articles`）；公开与否仍是每条记录自己的公开范围。作者在自己的主页、记录、合集和项目页上可以切到「访客视角」，看别人看到的样子。
- [导入](/product/features/import.md)：选导出的文件夹或全部 zip，记录、照片、附件、项目、合集、标签、地点和隐私区域进到自己的账号，链接换到这个站点；已经在的跳过、不覆盖，中途停下再导入一次接着做。

验收：搜「西湖」找到三年前的一条草稿；把三幅水彩记成「创作」、一篇长文记成「文章」，公开其中两幅和那篇文章，用访客视角看主页，只看到这三项；在日历上找到上个月空着的一天补记一笔，年度回顾里那一天随之变色；导出一次后在另一台电脑上用 Markdown 编辑器打开文件夹，记录、项目、合集和照片都在，链接都能点开；按备份与恢复把 D1 和 R2 恢复到新的库和桶，站点照常打开；把导出导入另一个站点的新账号，记录、照片、项目、合集都在，记录之间的链接打开的是新站点，再导入一次什么也不多。

# 以后

- 用 Workers AI 识别画面内容，自动建议题材标签和一句话描述
- 同机位对比：同一地点、相近朝向的照片并排比较
- 从 iCloud / Google 相册导入；离线可用的 PWA
- 游记导出为长图或 PDF
- 关注、收藏他人的合集；协作合集（多人共同编辑一次旅行）

# 不做

- 修图和滤镜
- 公开评论区（避免运营负担）
- 迁移到 WordPress、Directus 等 CMS
