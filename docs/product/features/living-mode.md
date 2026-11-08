---
type: Feature
title: Living 模式
description: 全屏轮播。什么都不选就随机播放全部；也可按标签、主题、地点、城市或"那年今日"取图；字段、间隔、转场都可配置，配置可写进链接。
tags: [browse, mvp]
route: "/living"
area: living
---
# 进入

| 入口 | 行为 | 链接示例 |
|---|---|---|
| 图库的 Living 按钮 | 沿用当前城市、标签、色调筛选；没有筛选时随机全部 | `/living?src=tags&tags=lake&city=杭州` |
| 照片详情 | 从这张开始 | `/living?start=<photoId>` |
| 地点页、地图侧栏 | 只播放这个地点 | `/living?src=place&place=<poiId>` |
| 游记 | 只播放这个主题 | `/living?src=theme&theme=<themeId>` |
| 直接打开 | 随机全部；可存书签或添加到主屏幕当相框 | `/living` |

个人主页的 Living 只播放该用户的照片（`user=<handle>`）。

# 播放

- 深色全屏；默认转场为缓慢推近（Ken Burns），可选淡入淡出、直接切换。
- 画面"铺满"时按照片焦点裁切，"完整"时留黑边。
- 预加载下一张；只播放 `in_living = 1` 的照片；收藏的照片出现概率加倍。
- 控制条：上一张、暂停/继续、下一张、序号、设置、退出；3 秒无操作自动隐藏，点按画面或移动鼠标再出现。
- 屏幕常亮（Wake Lock）、全屏（Fullscreen API）、夜间 22:00–07:00 调暗（可选）。

# 显示字段

默认只显示 **地点** 和 **日期**。可选：标题、城市、时间、距今（"1 年前的今天"）、坐标、朝向、相机参数、标签，以及与照片无关的时钟。位置可选左下 / 居中 / 右下；字号小 / 中 / 大；可设为"切换后只显示 6 秒"。笔记全文不在 Living 中显示。

# 参数

| 参数 | 取值 | 默认 |
|---|---|---|
| `src` | all · tags · place · city · theme · today | all |
| `tags` | 标签 id，逗号分隔 | — |
| `match` | any · all | any |
| `place` / `city` / `theme` / `user` | 对应 id 或名称 | — |
| `start` | 照片 id | — |
| `order` | shuffle · time | shuffle |
| `every` | 秒：5 · 10 · 30 · 60 · 300 · 900 | 10 |
| `fx` | drift · fade · cut | drift |
| `fit` | cover · contain | cover |
| `fields` | place,title,city,date,time,ago,coord,heading,exif,tags | place,date |
| `pos` | bl · bc · br | bl |
| `size` | s · m · l | m |
| `brief` / `clock` / `awake` / `night` | 0 · 1 | 0 / 0 / 1 / 0 |

链接参数优先；没写的沿用这台设备上次的设置（localStorage）。设置面板里的"复制链接"生成当前配置的完整链接。

# 操作

点按：显示/隐藏控制；← →：切换；空格：暂停；I：字段开关；S：设置；F：全屏；Esc：退出。触屏左右滑动切换。
