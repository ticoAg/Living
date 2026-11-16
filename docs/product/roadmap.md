---
type: Roadmap
title: 路线图
description: 影像图库已经可用；接下来分阶段演进为以记录为中心的个人数字档案：记录、项目、合集与媒体、完整档案。
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
- [主题](/product/features/themes.md) 和 [游记](/product/features/travelogue.md)
- [图库](/product/features/gallery.md)、[照片详情](/product/features/photo-detail.md)、[地点页](/product/features/places.md)、[地图](/product/features/map.md)、[索引](/product/features/index-page.md)
- [Living 模式](/product/features/living-mode.md)
- [隐私](/product/features/privacy.md) 和 [站点管理](/product/features/admin.md)

# 以记录为中心

方向见 [Issue #47](https://github.com/ticoAg/Living/issues/47) 和 [决策：以记录为中心](/architecture/decisions/0007-entry-first.md)。增量演进：现有页面、接口和链接一直可用。

## 阶段零：产品与数据设计（已完成）

- [内容模型](/product/content-model.md)：记录、媒体、项目、合集的边界与关系；记录的类型、时间、状态和可见性。
- [数据演进](/data/evolution.md)：项目与合集的表、旧主题的兼容方式、迁移规则、照片默认可见性的评估。
- 新内容默认仅自己可见的规则，见 [隐私](/product/features/privacy.md#记录)。

## 阶段一：记录成为一等公民（已完成）

- [记录](/product/features/entries.md)：可以只有文字；Markdown 正文、自动保存与草稿；关联自己的照片并写说明；标签；默认仅自己可见。
- [今天](/product/features/today.md)：随手记、今天的记录与照片、草稿、往年今天。
- [档案](/product/features/archive.md)：记录与照片按发生时间排成一条时间线，按类型、标签筛选，按年份跳转。
- 登录后的导航改为 今天、档案、图库（照片、地图、索引）、主题。

验收：不上传照片、不选主题或项目，就能快速记下一条私密记录；之后补上标题、正文、日期、标签和照片；在时间线里找得到。

## 阶段二：项目与成长档案（已完成）

- [项目](/product/features/projects.md)：名称、目标、类型、起止日期、状态（进行中、暂停、已完成），默认仅自己可见；在档案下与时间线并列，「今天」列出进行中的项目。
- 项目页：天数和统计、最初与最近的作品并排、按里程碑分出的阶段（作品和阶段总结）、项目内的记录。
- 记录在编辑器里选择所属的项目，可以不选；从项目页记一笔时预先选好，类型按项目定。

验收：建一个「从零开始学书法」，每次练习记一笔并带上作品照片，在项目页看练习时间线和阶段成果。

## 阶段三：合集、媒体和旧功能整合

- 合集由专题主题原地演进，加入记录条目；旅程主题单独评估，见 [数据演进](/data/evolution.md#主题)。旧的 `/t/:id`、游记内容和顺序保留。
- 记录可选关联地点；图库、地图和 Living 模式也能从记录出发。
- 照片上传的默认公开范围改为可设置，见 [数据演进](/data/evolution.md#照片的默认可见性)。
- 可撤销、可设有效期的分享链接。
- 视频、录音和文件等新媒体按需要加入。

## 阶段四：完整个人档案

- 日历和年度回顾。
- 全文搜索。
- 项目统计和成长视图。
- 文章、作品的展示和选择性公开。
- 完整导出（Markdown、JSON、原始媒体文件及元数据），备份与恢复流程。

# 以后

- 用 Workers AI 识别画面内容，自动建议题材标签和一句话描述
- 同机位对比：同一地点、相近朝向的照片并排比较
- 从 iCloud / Google 相册导入；离线可用的 PWA
- 游记导出为长图或 PDF
- 关注、收藏他人的主题；协作主题（多人共同编辑一次旅行）

# 不做

- 修图和滤镜
- 公开评论区（避免运营负担）
- 迁移到 WordPress、Directus 等 CMS
