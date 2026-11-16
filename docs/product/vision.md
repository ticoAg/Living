---
type: Product Vision
title: 产品愿景
description: Living 是一个人的私人数字档案：以记录为中心，照片是记录可以带上的媒体，长期的学习、创作和旅行都能在这里留下、整理和回看。
tags: [product]
status: stable
---
# 一句话

Living 是一个人的私人数字档案：随时记下发生的事、想法、练习和创作，带上照片，按时间、标签、地点回看。

最初它是一本按地点、时间和主题组织的影像地图集；现在照片成为记录可以带上的媒体，图库、地图、主题和游记照旧。概念之间的边界见 [内容模型](/product/content-model.md)，方向调整的缘由见 [决策：以记录为中心](/architecture/decisions/0007-entry-first.md)。

# 为谁

想长期记录自己的普通人，不是专业摄影师：旅行者、在同一座城市里反复拍同一个湖的人，也是学书法、读书、写东西的人。他们的照片散落在相册里，文字散落在备忘录里，事后很难回答"那次去西湖拍了什么""这一年字练得怎么样"。详见 [用户与场景](/product/personas.md)。

# 核心价值

1. **先记下来，再慢慢整理**：在 [今天](/product/features/today.md) 写一句就是一条 [记录](/product/features/entries.md)，不必先选类型、地点或主题；所有记录和照片在 [档案](/product/features/archive.md) 里按天排成一条时间线。
2. **默认只属于自己**：新记录仅自己可见，公开要自己选；分享出去的东西不会顺带公开其中的私密照片。见 [隐私](/product/features/privacy.md)。
3. **照片自己知道在哪**：根据 EXIF 里的 GPS 和镜头朝向，自动匹配到具体地点（断桥、孤山），而不只是一个坐标。见 [地点匹配](/product/features/poi-matching.md)。
4. **按自己的方式整理**：预置一套多层级标签，用户可以在任意层级添加自己的标签。见 [多层级标签](/product/features/hierarchical-tags.md)。
5. **每张照片都能写几句**：照片笔记连起来就是游记。见 [照片笔记](/product/features/photo-notes.md) 和 [主题](/product/features/themes.md)。
6. **好看地回看**：照片优先的图库、地图和地点页，以及适合放在客厅的 [Living 模式](/product/features/living-mode.md)。

# 设计原则

- 先给出可用的默认值，再允许修改：地点自动匹配、Living 默认只显示地点和日期、记录的发生时间默认是此刻。
- 位置是敏感信息：默认不公开原图，家附近自动隐藏坐标。见 [隐私](/product/features/privacy.md)。
- 数据存放在站长自己的 Cloudflare 账号里：D1 存记录和元数据，R2 存照片文件。这是托管存储，不等于本地自托管；完整导出与恢复在 [路线图](/product/roadmap.md) 的第四阶段。
- 少用说明文字，让版面说话。

# 设计稿

视觉方向为「画廊」：明亮的暖白底、白色的浮起表面、大圆角和柔和的阴影，照片优先；控件是填充的胶囊而不是描边的方框；地名和标题用宋体，界面用黑体；湖蓝表示链接与已匹配，赭色表示匹配半径、朝向与待确认。令牌与控件见 [前端分区](/architecture/frontend.md#设计令牌)。

最初的方向是「测绘图集」（冷调纸面、处处加宽字距的宋体、黑色方块按钮），设计画布：<https://claude.ai/artifact/8K26mkEtt3Xk55Lm4kr53F>。画布上的页面结构仍然适用，配色、字距和控件样式以现在的令牌为准。
