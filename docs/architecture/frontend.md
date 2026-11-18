---
type: Architecture
title: 前端分区
description: React SPA 的路由、页面归属、共享模块与设计令牌；每个分区只修改自己的文件。
tags: [architecture, frontend]
---
# 技术

React 19、wouter 路由；工具链是 [Vite+](/architecture/decisions/0006-vite-plus.md)（Vite 8 与 Rolldown 构建，Vitest、Oxlint、Oxfmt）；MapLibre 6 按需加载，它的 Worker 用 `?worker&url` 单独构建后交给 `setWorkerUrl`（见 `src/components/MapView.tsx`）；exifr、thumbhash 只在上传页加载；HEIC 解码器（libheif 的 WebAssembly 构建，在 Worker 里运行）只在选了浏览器打不开的 HEIC 文件时才加载。

字体自托管，不连第三方字体服务。界面文字用系统黑体（苹方、微软雅黑、Noto Sans CJK / 思源黑体），不下载。宋体、等宽、字标三种网络字体来自 `@fontsource/*`，只带用到的字重，全部 woff2，随 `/assets/` 一年 immutable 缓存：Noto Serif SC 500/600/700 保留 Google 的约 100 个 unicode-range 切片，页面只下载自己用到的字所在的那几片；DM Mono 400/500 与 Spectral 300/500 只带 latin 子集。`@font-face` 规则由 `vite.config.ts` 里的 `fonts()` 插件生成（虚拟模块 `virtual:fonts.css`，约 300 条，未压缩约 275 KB、brotli 约 21 KB），单独成一个样式表，不进主样式表：构建时 `index.html` 以 `media="print"` 加 `onload` 的方式引用它，与入口脚本并行下载而不阻塞渲染；`src/main.tsx` 的动态 `import()` 在开发时加载它。字标字体（Spectral 500）在 `index.html` 里 preload，页眉的 LIVING 不会先以 Georgia 闪一下。`font-display: swap`：字体到达前文字先用字体栈里的下一个字体显示，不出现空白。中文字形等宽，换字体基本只换笔画不换排版；实测字体换入造成的 CLS 每页不超过 0.004。

# 路由与归属

| 路由 | 页面文件 | 分区 |
|---|---|---|
| `/today` | `src/pages/Today.tsx` | entries |
| `/archive` | `src/pages/Archive.tsx` | entries |
| `/archive/calendar` | `src/pages/Calendar.tsx` | entries |
| `/archive/:year` | `src/pages/YearReview.tsx` | entries |
| `/entries/new` `/e/:id/edit` | `src/pages/EntryEditor.tsx` | entries |
| `/e/:id` | `src/pages/EntryReader.tsx` | entries |
| `/projects` | `src/pages/Projects.tsx` | projects |
| `/projects/new` `/projects/:id/edit` | `src/pages/ProjectForm.tsx` | projects |
| `/projects/:id` | `src/pages/ProjectPage.tsx` | projects |
| `/` | `src/pages/Explore.tsx` | browse |
| `/@:handle` | `src/pages/Profile.tsx` | browse |
| `/@:handle/works` | `src/pages/Works.tsx` | showcase |
| `/@:handle/articles` | `src/pages/Articles.tsx` | showcase |
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
| `/themes` `/themes/new` | `src/pages/Themes.tsx`、`ThemeEditor.tsx` | themes（合集） |
| `/t/:id` `/t/:id/edit` | `src/pages/ThemeReader.tsx`、`ThemeEditor.tsx` | themes（合集） |
| `/s/:token` | `src/pages/ShareOpen.tsx` | shares |
| `/search` | `src/pages/Search.tsx` | search |

页面模块按路由拆分，统一在 `src/routes.ts` 声明。首屏之后浏览器空闲时依次预取 browse、themes、living 以及今天、档案、记录阅读页、项目列表和项目页的分块（省流量模式与 2G 下跳过）；鼠标停在站内链接上约 80ms、按下或键盘聚焦时，预取目标路由的分块和它挂载时要发的 GET 请求（进入共享缓存），所以切页通常不再出现「加载中」。分块确实没到时，「加载中」在 400ms 后才显示。`src/lib/scroll.ts` 按历史记录保存滚动位置：前进、后退回到离开时的位置，新跳转从顶部开始。瀑布流（`src/browse/Masonry.tsx`）和档案的时间线分段渲染（`src/lib/usePaged.ts`），已渲染的数量记在当前历史记录的 `history.state` 里，返回时先渲染出同样多的内容，滚动位置才能恢复。

`/entries/new` 和 `/e/:id/edit` 是同一条路由（`src/App.tsx` 里的正则）：新记录第一次保存后地址换成 `/e/:id/edit`，编辑器不卸载，光标和输入法状态都不受影响；保存结果先写进共享缓存再换地址。

## 分块失效与错误

每次发布都会换掉 `/assets/` 下带哈希的文件。发布前打开的标签页再去取旧分块时，静态资源找不到文件，按单页应用的规则回一份 `index.html`，`import()` 因此失败。

- `src/components/ErrorBoundary.tsx` 包在路由外面，页眉留在边界外；地址变化时清除错误状态，所以从页眉的链接就能离开。
- 分块加载失败（`src/lib/chunks.ts` 的 `isChunkError`）时整页跳到当前地址一次，拿到新的 `index.html` 和新的分块名；跳转期间显示「加载中」。`sessionStorage` 记下跳转时间，一分钟内再次失败就不再跳转，显示「页面没能加载」和「刷新」按钮，不会循环刷新。
- 后台预取的分块失败时（Vite 的 `vite:preloadError` 事件），不刷新眼前的页面（上面可能有没保存的内容），只记下「版本已过期」：之后点站内链接改为整页跳转到目标地址，页面自己的离开提醒仍然有效。
- 其他渲染错误显示「出错了」和「刷新」按钮。
- `React.lazy` 一旦失败会一直抛同一个错误，所以恢复靠整页跳转，不在页面内重试；预取失败不会让 `lazy` 失败，渲染时会重新请求。

分区的私有代码放在 `src/<分区>/`，样式放在 `src/styles/<分区>.css` 并由该分区页面引入。页面组件只做编排：状态与流程放在分区目录的 Hook 里（`use*.ts`，一个 Hook 管一件事），可以写成纯函数的部分单独成模块并配单元测试。例如上传页的队列、读取、地点匹配、发布与选择分别在 `src/studio/useUploadQueue.ts`、`useProcessQueue.ts`、`usePlaceMatching.ts`、`usePublishing.ts`、`useQueueSelection.ts`；Living 的数据、播放与控制条在 `src/living/useLivingData.ts`、`usePlayback.ts`、`useBar.ts`；合集编辑的保存与删除、拖拽排序在 `src/themes/useThemeSave.ts`、`useItemDrag.ts`，草稿与条目的换算在 `draft.ts`、`items.ts`，阅读页的分块、路线和 Living 播放的照片在 `model.ts`；记录编辑的自动保存、本机备份和冲突处理在 `src/entries/useEntryAutosave.ts`，草稿与请求体的换算在 `src/entries/draft.ts`，时间线与「今天」的分组在 `src/entries/timeline.ts`，Markdown 的解析与渲染在 `src/entries/markdown.ts`、`Markdown.tsx`；项目的天数、按里程碑分阶段、最初与最近的作品、节奏和列表顺序在 `src/projects/stages.ts`；日历的周、每天的格子、颜色深浅、连续天数和按月计数在 `src/review/calendar.ts`，小月历和按月的柱子是 `src/review/HeatMonth.tsx`、`MonthBars.tsx`，日期的加减在 `shared/days.ts`（Worker 也用它划定日期范围）；分享链接的请求、地址和有效期文字在 `src/shares/api.ts`，记录、合集、项目页上的「分享」对话框是 `src/shares/ShareButton.tsx`，设置里的列表复用同一个 `ShareItem.tsx`；[作品与文章](/product/features/showcase.md) 的分组、按年份分段、字数、封面照片和按类型读取的地址在 `src/showcase/showcase.ts`，作品的格子和按批请求封面在 `WorkTile.tsx`、`WorkGrid.tsx`，文章的一行在 `ArticleRow.tsx`，个人主页也用它们。

## 访客视角

地址带 `?as=visitor` 时，`src/App.tsx` 把路由包进 `src/components/VisitorView.tsx`，页眉留在外面：

- `VisitorContext`（`src/lib/visitor.ts`）为真，`useApi(path)` 改用缓存键 `visitor:` + path，请求不带 Cookie、不读浏览器缓存（`api()` 的 `anonymous`）。同一个地址自己读和访客读分开缓存；任何失效、`forget`、`setCached` 都丢掉全部访客副本：访客看到什么不只取决于作者那边会刷新的地址（一张照片改为公开，包含它的记录在访客眼里变了，作者的那份却没变），改完再看访客视角不会是旧的。访客请求的 401 不当作会话过期。
- `AsVisitor`（`src/lib/session.tsx`）让里面的页面看到「没有登录」：`own`、编辑、分享这些都按访客算。
- 里面的 wouter `Router` 用 `hrefs` 和 `aroundNav` 给访客也能打开的页面（`withVisitor`）的链接和跳转加上 `?as=visitor`，去别的页面就离开访客视角；横栏的「退出」在这个 `Router` 外面，去掉参数回到自己的视角。悬停预取（`src/routes.ts`）对带 `?as=visitor` 的链接也按访客的缓存键预取。自己改写地址的页面用 `keepVisitor` 留住参数（Living 的 `replaceUrl`），否则 `App` 离开访客视角，页面重新挂载。
- 照片页的上一张、下一张用列表页记下的顺序（`src/browse/context.ts`），记下时注明视角，只在同一视角里用，访客视角里不会翻到自己才看得到的照片。
- `--vv-h` 是横栏的高度：`:root:has(.vv-bar)` 把它设为 `scroll-padding-top`，锚点和滚动定位让开横栏；铺满一屏的地图页减去它；合集阅读页的 `scrollToItem` 量页眉和横栏的底边。Living 全屏播放，横栏不显示。

# 共享模块（改动需要协调）

| 模块 | 作用 |
|---|---|
| `shared/types.ts` | 前后端共用的接口类型，即 [接口约定](/api/conventions.md) 的代码形式 |
| `shared/geo.ts` | 距离、方位角、坐标转换、扇形与圆、度分秒格式 |
| `shared/entries.ts` | 记录类型与状态的名字、列表摘要的截取、记录的纯文本名字（照片页的所属记录、浏览器标签页的标题用） |
| `shared/projects.ts` | 项目类型与状态的名字、从项目新写的记录的类型（`entryTypeFor`）、两个本地日期之间的天数 |
| `shared/limits.ts` | 输入上限：照片、合集、合集条目、记录、标签、账号（含用户名格式 `HANDLE_RE`）、隐私区域、邀请码、地点搜索与地区名；地点编辑的 `POI_LIMITS` 留在 `shared/types.ts`，在这里再导出。Worker 的校验和表单的 `maxLength`、提示文案、发送前检查都引用它，不另写数字 |
| `src/lib/api.ts` | `api<T>()` 请求封装、`mediaUrl()`；`/api/auth/*` 以外的 401 经 `onSessionLost` 通知会话层；`anonymous` 以访客身份请求（不带 Cookie、不读浏览器缓存） |
| `src/lib/visitor.ts` | [访客视角](#访客视角)：`VisitorContext`、`withVisitor` / `withoutVisitor`（哪些页面保持访客视角）、`isVisitorSearch`、`keepVisitor`（自己改写地址的页面留住访客视角） |
| `src/lib/useApi.ts` | 共享 GET 缓存 `useApi(path)`、`invalidate(prefix)`、`prefetch(path)`、`setCached(path, data)`、`forget(path)`（删除后丢掉，不再显示也不重取）。结果 5 分钟内算新鲜；过期后在组件挂载或标签页重新可见时后台重取，期间继续显示旧数据；失败的结果在下次挂载时重试。不定时轮询：列表接口每次全量读，D1 免费版按读取行数计额。组件用 `useSyncExternalStore` 订阅，渲染和订阅之间到达的结果（预取的数据在懒加载页面提交前返回）不会丢。访客视角里用 `visitorKey(path)` 另存一份，任何改动都丢掉全部访客副本。`useApiEach(paths)` 一次读几个地址（一份分成几次请求的列表，如按 id 分批要的照片） |
| `src/lib/chunks.ts` | 分块失效的识别与一次性整页重新加载，见 [分块失效与错误](#分块失效与错误) |
| `src/lib/scroll.ts` | 按历史记录恢复滚动位置；页面经 `useScrollTop` 调用 |
| `src/lib/usePaged.ts`、`shown.ts` | 长列表分段渲染：先渲染一页，接近底部时再接一页，数量记在 `history.state` |
| `src/lib/deviceDrafts.ts` | 记录在本机暂存的前缀；退出登录时清除 |
| `src/lib/session.tsx` | `useSession()`：当前用户、站点信息、退出；`AsVisitor` 让里面的页面看到没有登录（访客视角）。请求遇到 401 时向服务端确认，会话确已失效就标记 `expired`（页眉显示未登录，页面保留原用户以免表单被卸载）并打开 `src/components/ReLogin.tsx` 的重新登录对话框，见 [账号](/product/features/accounts.md#会话过期) |
| `src/lib/tags.ts` | 标签树、子孙展开、按标签筛选、包含计数 |
| `src/lib/format.ts` | 日期、时段、距今、距离、度分秒；浏览器本地的今天 `localDay()` 和此刻 `localDateTime()` |
| `src/components/Img.tsx` | 响应式图片 + ThumbHash 占位 |
| `src/components/MapView.tsx` | MapLibre 封装：点、图集（`albums` 属性，标记由 `mapAlbums.ts` 绘制；分级、合并与命名在 `src/browse/albums.ts`，照片和记录两个图层共用，见 [地图](/product/features/map.md)）、半径圈、朝向扇形、连线；`fitKey` 让视野只在它变化时重新缩放；署名在地图加载后收成 ⓘ（地图页 `/map` 保持 MapLibre 默认） |
| `src/components/icons.tsx` | 地点类别符号 `CategoryIcon`、界面图标 `Icon` |
| `src/components/PhotoPicker.tsx` | 从自己的照片里挑选（按日期范围、标签，可多选），合集编辑器和记录编辑器共用 |
| `src/components/PickerDialog.tsx` | 挑选器的对话框：照片挑选器和合集编辑器的记录挑选器（`src/themes/EntryPicker.tsx`）共用，Esc 或点背景关闭 |
| `src/components/AutoTextarea.tsx` | 随内容长高的文本框 |
| `src/components/SectionTabs.tsx` | 一个分区内几页之间的标签（图库的照片 / 地图 / 索引、档案的时间线 / 项目），只对登录的人显示 |
| `src/components/Header.tsx` | 站点页眉与导航（见 [导航](#导航)）：字标在左，四个分区居中（当前分区是一枚衬底色的胶囊），登录后的搜索按钮、上传按钮和账户菜单在右；手机上（≤640px）页眉一行（字标、上传、账户），四个分区移到底部固定栏，每项是图标加名字，登录后栏的正中是拍照按钮 |
| `src/components/CaptureButton.tsx` | 手机底栏的拍照按钮：打开页面内相机（`src/studio/CameraSheet.tsx`，按需加载），拍下的照片连同手机定位交给上传队列；系统相机作为备选，见 [拍照](/product/features/upload.md#拍照) |
| `src/components/ErrorBoundary.tsx` | 路由外的错误边界：分块失效时重新加载，其他错误显示「出错了」 |
| `src/components/VisitorView.tsx`、`VisitorLink.tsx` | 访客视角的横栏和外壳；作者页面上的「访客视角」按钮 |
| `src/styles/base.css` | 设计令牌与通用控件（按钮、标签片、色块、分段、输入框） |

# 导航

| 身份 | 分区 |
|---|---|
| 访客 | 图库、合集、地图、索引 |
| 登录后 | 今天、档案、图库、合集 |

登录后页眉右侧有搜索按钮，在任何页面按 `/`（不在输入框里时）也能打开 [搜索](/product/features/search.md)，已经在搜索页时把光标放进搜索框（`src/search/shortcut.ts`）。

登录后图库、地图、索引合为「图库」一个分区，三个页面顶部用 `src/browse/LibraryTabs.tsx` 的「照片 / 地图 / 索引」切换；照片页和地点页也算在图库里。档案的时间线、日历和项目同样是一个分区，顶部用 `src/entries/ArchiveTabs.tsx` 的「时间线 / 日历 / 项目」切换，年度回顾算在日历里；项目页、项目的新建与编辑，已有记录的阅读和编辑页都算在档案里，新建记录算在今天里。分区数不变，手机底栏的拍照按钮仍在正中。

# 设计令牌

视觉方向是「画廊」：明亮的暖白底、白色的浮起表面、照片优先。控件用填充而不是描边，名字用宋体，界面用黑体。令牌都在 `src/styles/base.css` 的 `:root` 里。

| 用途 | 令牌与取值 |
|---|---|
| 底与表面 | 纸面 `--paper` `#F7F6F3`（页面底色）、表面 `--sheet` `#FFFFFF`（卡片、菜单、输入框）、衬底 `--mat` `#EFEDE8`（标签片、分段的轨道、图片占位、悬停）、`--mat-2` `#E4E1DA`（按下、衬底上的悬停） |
| 文字 | 墨 `--ink` `#18191B`、次级墨 `--ink-2` `#54585B`、三级墨 `--ink-3` `#666A6D`（11–13px 的小字，在纸面、表面和衬底上都不低于 4.5:1） |
| 线 | 细线 `--rule` `#E8E5DF`（分隔、卡片边）、`--rule-2` `#D3CFC7`（输入框边） |
| 强调 | 湖蓝 `--hydro` `#2B5F86`（链接、焦点、已匹配），底色 `--hydro-wash`；赭 `--sienna` `#96562E`（匹配半径、朝向、待确认、旅程），底色 `--sienna-wash`；`--danger` `#B0392B`，底色 `--danger-wash` |
| 圆角 | 照片 `--r-img` 8px、控件 `--r-ctl` 12px、卡片 `--r-card` 20px、大块（照片衬底、地图、对话框）`--r-stage` 24px、按钮与标签片 `--r-pill` |
| 层次 | `--lift-1`（静止的卡片）、`--lift-2`（浮起、悬停）、`--lift-3`（菜单、对话框）；焦点环 `--ring` |
| 控件高度 | `--ctl`：触屏 44px、鼠标 40px；`--ctl-s`（标签片）：触屏 44px、鼠标 32px |

通用控件（`base.css`）：

- **按钮** `.btn` 是胶囊形，默认衬底色填充；`.btn-primary` 墨色填充（一个视图里只给最主要的动作）；`.btn-quiet` 白底细边；`.btn-ghost` 透明，悬停才有底；`.btn-danger` 红色底。
- **标签片** `.chip` 平时只是文字，悬停出现底色，选中是墨色胶囊；所在子树被选中时（`data-included`）是衬底色。
- **分段** `.seg` 是一条衬底色的轨道，选中的那一项是浮起的白色滑块。
- **输入框** `.input` `.textarea` `.select` 白底细边、12px 圆角，聚焦时边变湖蓝并带一圈焦点环。
- 「部分选中」（一起整理多张照片时只有一部分有的标签、合集）画成墨色描边、不填充；全部都有的是墨色填充。
- 状态（上传队列、合集类型、可见性提示）用「色点 + 文字 + 该状态颜色的浅底」，不用描边框。
- 页眉、吸底的操作栏和手机底栏是半透明的纸面加背景模糊。页眉的模糊画在 `::before` 上：带 `backdrop-filter` 的元素会成为它里面 `position: fixed` 元素的定位容器，而手机底栏正是页眉里的固定元素。
- 地图 `.map-frame` 圆角、无边框，边缘的细线由 `::after` 画在瓦片上面；缩放按钮是白色圆角块。

字体（`--serif`、`--sans`、`--mono`、`--latin`）：宋体 Noto Serif SC 只用于名字和标题（地点名、照片标题、合集与记录的标题、页面标题、游记正文；字重 500/600/700，写 400 的地方显示为 500），字距 0.04–0.1em；界面上的一切（按钮、标签片、表单、表头、文件名）用系统黑体；DM Mono 用于坐标与数字（400/500）；Spectral 用于 LIVING 字标和大号数字（300/500，无斜体）。样式里要用新的字重或斜体，先在 `vite.config.ts` 的 `FONTS` 里加上，否则浏览器会用相近字重或合成粗体。Living 模式和相机使用深色（`--night*` 令牌）。

# 约定

- 文案用中文，简短；能用版面说明的不加说明文字。
- 交互控件用真实的 `button`、`a`、`input`，触控目标不小于 44px（用鼠标时按 `--ctl`、`--ctl-s` 收紧），图标按钮带 `aria-label`。
- 不用虚线框和黑色硬块表示状态或分区：用底色、圆角和留白分层，描边只留给输入框和「部分选中」。
- 地址栏承载可分享的状态（筛选、选中地点、Living 参数）。
- 手机（≤640px）：`--header-h` 是 52px；底部导航栏的高度是 `--nav-foot`（含安全区，没有页眉的页面为 0），页面底部留白、滚动定位和吸底的操作栏都让开它。筛选收进「筛选」按钮（`FilterToggle`），按钮上显示已选个数。
