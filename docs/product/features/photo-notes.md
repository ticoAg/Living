---
type: Feature
title: 照片笔记
description: 每张照片可以写一段笔记，在照片详情、游记和 Living 模式里显示。
tags: [record, mvp]
area: studio
---
# 用户故事

- 上传时顺手给几张照片写一两句："断桥上人太多，往北山街口走了五十米才拍到这张。"
- 事后在照片编辑页补写，或在主题编辑器里边排顺序边写。

# 规则

- 字段：`photos.note`，纯文本，支持换行、段落和链接（自动识别网址），最长 5000 字。
- 不支持图片、表格和 HTML；显示时转义所有 HTML。
- 笔记属于照片本身；同一张照片放进多个主题，笔记相同。主题里还可以给某张照片写"本主题内的说明"（`theme_items.text`），优先显示。
- 有笔记的照片在图库缩略图上不额外标记（保持画面干净），在详情页和游记里完整显示。
- Living 模式不显示笔记全文（见 [Living 模式](/product/features/living-mode.md)）。

# 相关

- [主题](/product/features/themes.md)、[游记](/product/features/travelogue.md)、[上传与整理](/product/features/upload.md)
