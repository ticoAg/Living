---
type: Architecture
title: 前端分区
description: React SPA 的路由、页面归属、共享模块与设计令牌；每个分区只修改自己的文件。
tags: [architecture, frontend]
---
# 技术

React 19、wouter 路由；工具链是 [Vite+](/architecture/decisions/0006-vite-plus.md)（Vite 8 与 Rolldown 构建，Vitest、Oxlint、Oxfmt）；MapLibre 6 按需加载，它的 Worker 用 `?worker&url` 单独构建后交给 `setWorkerUrl`（见 `src/components/MapView.tsx`）；exifr、thumbhash 只在上传页加载；HEIC 解码器（libheif 的 WebAssembly 构建，在 Worker 里运行）只在选了浏览器打不开的 HEIC 文件时才加载。

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

页面模块按路由拆分，统一在 `src/routes.ts` 声明。首屏之后浏览器空闲时依次预取 browse、themes、living 的分块（省流量模式与 2G 下跳过）；鼠标停在站内链接上约 80ms、按下或键盘聚焦时，预取目标路由的分块和它挂载时要发的 GET 请求（进入共享缓存），所以切页通常不再出现「加载中」。分块确实没到时，「加载中」在 400ms 后才显示。`src/lib/scroll.ts` 按历史记录保存滚动位置：前进、后退回到离开时的位置，新跳转从顶部开始。

## 分块失效与错误

每次发布都会换掉 `/assets/` 下带哈希的文件。发布前打开的标签页再去取旧分块时，静态资源找不到文件，按单页应用的规则回一份 `index.html`，`import()` 因此失败。

- `src/components/ErrorBoundary.tsx` 包在路由外面，页眉留在边界外；地址变化时清除错误状态，所以从页眉的链接就能离开。
- 分块加载失败（`src/lib/chunks.ts` 的 `isChunkError`）时整页跳到当前地址一次，拿到新的 `index.html` 和新的分块名；跳转期间显示「加载中」。`sessionStorage` 记下跳转时间，一分钟内再次失败就不再跳转，显示「页面没能加载」和「刷新」按钮，不会循环刷新。
- 后台预取的分块失败时（Vite 的 `vite:preloadError` 事件），不刷新眼前的页面（上面可能有没保存的内容），只记下「版本已过期」：之后点站内链接改为整页跳转到目标地址，页面自己的离开提醒仍然有效。
- 其他渲染错误显示「出错了」和「刷新」按钮。
- `React.lazy` 一旦失败会一直抛同一个错误，所以恢复靠整页跳转，不在页面内重试；预取失败不会让 `lazy` 失败，渲染时会重新请求。

分区的私有代码放在 `src/<分区>/`，样式放在 `src/styles/<分区>.css` 并由该分区页面引入。

# 共享模块（改动需要协调）

| 模块 | 作用 |
|---|---|
| `shared/types.ts` | 前后端共用的接口类型，即 [接口约定](/api/conventions.md) 的代码形式 |
| `shared/geo.ts` | 距离、方位角、坐标转换、扇形与圆、度分秒格式 |
| `src/lib/api.ts` | `api<T>()` 请求封装、`mediaUrl()`；`/api/auth/*` 以外的 401 经 `onSessionLost` 通知会话层 |
| `src/lib/useApi.ts` | 共享 GET 缓存 `useApi(path)`、`invalidate(prefix)`、`prefetch(path)`、`setCached(path, data)`。结果 5 分钟内算新鲜；过期后在组件挂载或标签页重新可见时后台重取，期间继续显示旧数据；失败的结果在下次挂载时重试。不定时轮询：列表接口每次全量读，D1 免费版按读取行数计额 |
| `src/lib/chunks.ts` | 分块失效的识别与一次性整页重新加载，见 [分块失效与错误](#分块失效与错误) |
| `src/lib/scroll.ts` | 按历史记录恢复滚动位置；页面经 `useScrollTop` 调用 |
| `src/lib/session.tsx` | `useSession()`：当前用户、站点信息、退出。请求遇到 401 时向服务端确认，会话确已失效就标记 `expired`（页眉显示未登录，页面保留原用户以免表单被卸载）并打开 `src/components/ReLogin.tsx` 的重新登录对话框，见 [账号](/product/features/accounts.md#会话过期) |
| `src/lib/tags.ts` | 标签树、子孙展开、按标签筛选、包含计数 |
| `src/lib/format.ts` | 日期、时段、距今、距离、度分秒 |
| `src/components/Img.tsx` | 响应式图片 + ThumbHash 占位 |
| `src/components/MapView.tsx` | MapLibre 封装：点、图集（`albums` 属性，标记由 `mapAlbums.ts` 绘制，见 [地图](/product/features/map.md)）、半径圈、朝向扇形、连线；`fitKey` 让视野只在它变化时重新缩放；署名在地图加载后收成 ⓘ（地图页 `/map` 保持 MapLibre 默认） |
| `src/components/icons.tsx` | 地点类别符号 `CategoryIcon`、界面图标 `Icon` |
| `src/components/Header.tsx` | 站点页眉与导航 |
| `src/components/ErrorBoundary.tsx` | 路由外的错误边界：分块失效时重新加载，其他错误显示「出错了」 |
| `src/styles/base.css` | 设计令牌与通用控件（按钮、标签片、色块、分段、输入框） |

# 设计令牌

纸面 `#F1F2EE`、卡纸 `#E6E8E2`、墨 `#1C201E`、次级墨 `#5A605C`、三级墨 `#686E6A`（11–13px 的小字，在纸面和卡纸 `#FAFAF8` 上都不低于 4.5:1）、细线 `#D3D6D0`、湖蓝 `#2B5F86`（链接、水体注记）、赭 `#8F5530`（等高线、匹配半径、朝向）。字体：宋体 Noto Serif SC 用于地名与标题（加宽字距 0.24–0.5em），Noto Sans SC 用于界面，DM Mono 用于坐标与数字，Spectral 用于 LIVING 字标。Living 模式使用深色（`--night*` 令牌）。

# 约定

- 文案用中文，简短；能用版面说明的不加说明文字。
- 交互控件用真实的 `button`、`a`、`input`，触控目标不小于 44px，图标按钮带 `aria-label`。
- 地址栏承载可分享的状态（筛选、选中地点、Living 参数）。
