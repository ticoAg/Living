---
type: Feature
title: 上传与整理
description: 批量选择或拖入照片，浏览器读取 EXIF、生成三种尺寸和占位图，匹配地点、建议标签，确认后发布。
tags: [record, mvp]
route: "/upload, /studio/photo/:id"
area: studio
---
# 流程

1. 拖入或选择多张照片（JPEG、PNG、WebP、AVIF；HEIC 仅在能解码它的浏览器里，如 Safari）。
2. 浏览器端逐张处理：读取 EXIF（时间、时区、GPS、海拔、朝向、相机、镜头、焦距、光圈、快门、ISO）；按方向旋正；生成长边 480 / 1600 / 2560 的 WebP（不支持时用 JPEG）；生成 ThumbHash；提取 5 个主色；计算 SHA-256 用于去重。生成的图不含 EXIF。
3. 有 GPS 的照片请求 [地点匹配](/product/features/poi-matching.md)，自动选中第一名；拿不准时标记"待确认"。
4. 没有 GPS 的照片，按拍摄时间找同批里前后 2 小时内最近的一张有地点的照片，给出"按时间推断"；也可以搜索地点或新建自定义地点。
5. 每张照片可填标题、[笔记](/product/features/photo-notes.md)、[标签](/product/features/hierarchical-tags.md)（含自动建议）、公开范围、位置精度、是否进入 Living、加入哪些 [主题](/product/features/themes.md)。
6. 发布：上传原图和三种尺寸到 R2，写入 D1。可逐张发布，也可"发布全部已匹配"。

# 队列状态

已匹配 / 待确认 / 无位置 / 位置不公开（在隐私区域内）/ 已发布 / 失败（可重试）。

# 规则

- 单张原图上限 50 MB；同一用户重复上传同一文件（SHA-256 相同）时提示已存在并跳过。
- 原图只有本人能下载；公开展示只用生成的尺寸。
- 上传中途关闭页面，未发布的照片不会入库。

# 编辑

`/studio/photo/:id` 可以修改标题、笔记、标签、地点、公开范围、位置精度、是否进入 Living、收藏，或删除照片（同时删除 R2 中的所有文件）。
