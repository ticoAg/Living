---
type: Architecture
title: 前端分区
description: React SPA 的路由、页面归属、共享模块与设计令牌；每个分区只修改自己的文件。
tags: [architecture, frontend]
---
# 技术

React 19、wouter 路由；工具链是 [Vite+](/architecture/decisions/0006-vite-plus.md)（Vite 8 与 Rolldown 构建，Vitest、Oxlint、Oxfmt）；MapLibre 6 按需加载，它的 Worker 用 `?worker&url` 单独构建后交给 `setWorkerUrl`（见 `src/components/MapView.tsx`）；exifr、thumbhash、suncalc 只在上传页加载；HEIC 解码器（libheif 的 WebAssembly 构建，在 Worker 里运行）只在选了浏览器打不开的 HEIC 文件时才加载。

# 路由与归属

| 路由 | 页面文件 | 分区 |
|---|---|---|
| `/` | `src/pages/Explore.tsx` | browse |
| `/@:handle` | `src/pages/Profile.tsx` | browse |
| `/p/:id` | `src/pages/Photo.tsx` | browse |
| `/place/:id` | `src/pages/Place.tsx` | browse |
| `/map` | `src/pages/MapPage.tsx` | browse |
| `/index` | `src/pages/IndexPage.tsx` | browse |
| `/living` | `src/pages/Living.tsx` | living |
| `/upload` | `src/pages/Upload.tsx` | studio |
| `/studio/photo/:id` | `src/pages/PhotoEdit.tsx` | studio |
| `/studio/place/:id` | `src/pages/PlaceEdit.tsx` | studio |
| `/studio/tags` | `src/pages/TagsManager.tsx` | studio |
| `/login` `/register` `/settings` | `src/pages/Login.tsx` 等 | studio |
| `/themes` `/themes/new` | `src/pages/Themes.tsx`、`ThemeEditor.tsx` | themes |
| `/t/:id` `/t/:id/edit` | `src/pages/ThemeReader.tsx`、`ThemeEditor.tsx` | themes |

分区的私有代码放在 `src/<分区>/`，样式放在 `src/styles/<分区>.css` 并由该分区页面引入。

# 共享模块（改动需要协调）

| 模块 | 作用 |
|---|---|
| `shared/types.ts` | 前后端共用的接口类型，即 [接口约定](/api/conventions.md) 的代码形式 |
| `shared/geo.ts` | 距离、方位角、坐标转换、扇形与圆、度分秒格式 |
| `src/lib/api.ts` | `api<T>()` 请求封装、`mediaUrl()` |
| `src/lib/useApi.ts` | 共享 GET 缓存 `useApi(path)`、`invalidate(prefix)` |
| `src/lib/session.tsx` | `useSession()`：当前用户、站点信息、退出 |
| `src/lib/tags.ts` | 标签树、子孙展开、按标签筛选、包含计数 |
| `src/lib/format.ts` | 日期、时段、距今、距离、度分秒 |
| `src/components/Img.tsx` | 响应式图片 + ThumbHash 占位 |
| `src/components/MapView.tsx` | MapLibre 封装：点、图集（`albums` 属性，标记由 `mapAlbums.ts` 绘制，见 [地图](/product/features/map.md)）、半径圈、朝向扇形、连线；`fitKey` 让视野只在它变化时重新缩放 |
| `src/components/icons.tsx` | 地点类别符号 `CategoryIcon`、界面图标 `Icon` |
| `src/components/Header.tsx` | 站点页眉与导航 |
| `src/styles/base.css` | 设计令牌与通用控件（按钮、标签片、色块、分段、输入框） |

# 设计令牌

纸面 `#F1F2EE`、卡纸 `#E6E8E2`、墨 `#1C201E`、次级墨 `#5A605C`、细线 `#D3D6D0`、湖蓝 `#2B5F86`（链接、水体注记）、赭 `#8F5530`（等高线、匹配半径、朝向）。字体：宋体 Noto Serif SC 用于地名与标题（加宽字距 0.24–0.5em），Noto Sans SC 用于界面，DM Mono 用于坐标与数字，Spectral 用于 LIVING 字标。Living 模式使用深色（`--night*` 令牌）。

# 约定

- 文案用中文，简短；能用版面说明的不加说明文字。
- 交互控件用真实的 `button`、`a`、`input`，触控目标不小于 44px，图标按钮带 `aria-label`。
- 地址栏承载可分享的状态（筛选、选中地点、Living 参数）。
