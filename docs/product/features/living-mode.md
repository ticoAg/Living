---
type: Feature
title: Living 模式
description: 全屏轮播。什么都不选就随机播放全部；也可按标签、合集、记录、地点、城市或"那年今日"取图；字段、间隔、转场都可配置，配置可写进链接。
tags: [browse, mvp]
route: "/living"
area: living
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/src/living/settings.ts
    title: 参数
  - resource: https://github.com/ticoAg/Living/blob/main/src/living/entries.ts
    title: 记录里的照片
---
# 进入

| 入口 | 行为 | 链接示例 |
|---|---|---|
| 图库的 Living 按钮 | 沿用当前城市、标签、色调筛选；没有筛选时随机全部 | `/living?src=tags&tags=lake&city=杭州` |
| 照片详情 | 从这张开始 | `/living?start=<photoId>` |
| 地点页、地图侧栏 | 只播放这个地点 | `/living?src=place&place=<poiId>` |
| 合集（游记） | 只播放这个合集：照片条目和记录条目里的照片，按合集的顺序，同一张只放一次 | `/living?src=theme&theme=<themeId>` |
| 记录页 | 只播放这条记录的照片，按记录里的顺序；没有照片的记录没有这个按钮 | `/living?src=entry&entry=<entryId>` |
| 图库的记录层 | 所有人公开的记录里的照片，沿用类型筛选 | `/living?src=entries&type=practice` |
| 直接打开 | 随机全部；可存书签或添加到主屏幕当相框 | `/living` |

个人主页的 Living 只播放该用户的照片（`user=<handle>`）。

# 记录

- `src=entry`：一条记录里看的人能打开的照片，按记录里的顺序（`order=time` 时；`shuffle` 也行）。城市、用户对它不起作用，和合集一样。看的人打不开这条记录时（不存在，或别人的草稿、仅自己可见的记录）显示错误。
- `src=entries`：已完成的记录里的照片。没有 `user` 是所有人公开的记录（[记录接口](/api/entries.md#get-apientries) 不带参数），有 `user` 是这个人的记录里看的人能看到的；`type` 只取这些类型（逗号分隔）。草稿和已归档的不放，作者自己也一样。
  - 记录按发生时间从新到旧，每条按自己的顺序取照片；同一张在几条记录里只放一次，算在最新的那条里。
  - 照片多半已在照片列表里；不在的（仅链接的，或作者自己仅自己可见的）按 id 再要，每次最多 200 张。
  - 默认随机；按时间时按拍摄时间，和其他来源一样。城市照常筛选。
- 字幕的「记录」一行写照片所在记录的名字：标题，没有标题是正文开头，再没有是类型名。读屏器也念出来。
- 设置面板的「来源」多一个「记录」（`src=entries`）。打开的链接是一条记录时，多一个「记录 · <名字>」开关；带了类型时，多一个「类型 · 练习」开关，关掉放所有类型。

# 播放

- 深色全屏；默认转场为缓慢推近（Ken Burns），可选淡入淡出、直接切换。
- 画面"铺满"时按照片焦点裁切，"完整"时留黑边。
- 预加载下一张；只播放 `in_living = 1` 的照片；收藏的照片出现概率加倍。
- 控制条：上一张、暂停/继续、下一张、序号、设置、退出；3 秒无操作自动隐藏，点按画面或移动鼠标再出现。
- 屏幕常亮（Wake Lock）、全屏（Fullscreen API）、夜间 22:00–07:00 调暗（可选）。

# 显示字段

默认显示 **地点**、**记录** 和 **日期**；记录只在播放记录时有内容。可选：标题、城市、时间、距今（"1 年前的今天"）、坐标、朝向、相机参数、标签，以及与照片无关的时钟。这台设备以前存过设置的也一样：本机记着存的时候有哪些字段，后来新加的按默认值；在设置里关掉以后就记住。以前一个字段都不显示的，仍然不显示。位置可选左下 / 居中 / 右下；字号小 / 中 / 大；可设为"切换后只显示 6 秒"。笔记全文不在 Living 中显示。

# 参数

| 参数 | 取值 | 默认 |
|---|---|---|
| `src` | all · tags · place · city · theme · today · entries · entry | all |
| `tags` | 标签 id，逗号分隔 | — |
| `match` | any · all | any |
| `place` / `city` / `theme` / `entry` / `user` | 对应 id 或名称 | — |
| `type` | 记录类型，逗号分隔：note,article,reading,practice,creation,trip；只用于 `src=entries` | — |
| `start` | 照片 id | — |
| `order` | shuffle · time | shuffle；合集和一条记录是 time |
| `every` | 秒：5 · 10 · 30 · 60 · 300 · 900 | 10 |
| `fx` | drift · fade · cut | drift |
| `fit` | cover · contain | cover |
| `fields` | place,title,entry,city,date,time,ago,coord,heading,exif,tags | place,entry,date |
| `pos` | bl · bc · br | bl |
| `size` | s · m · l | m |
| `brief` / `clock` / `awake` / `night` | 0 · 1 | 0 / 0 / 1 / 0 |

链接参数优先；没写的沿用这台设备上次的设置（localStorage）。设置面板里的"复制链接"生成当前配置的完整链接。

# 操作

点按：显示/隐藏控制；← →：切换；空格：暂停；I：字段开关；S：设置；F：全屏；Esc：退出。触屏左右滑动切换。
