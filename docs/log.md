# Directory Update Log

## 2026-11-11
* **Update**: 手机底栏正中新增拍照按钮：打开系统相机，拍完进入上传队列；照片文件没有位置时用手机定位补上并注明精度，见 [拍照](/product/features/upload.md#拍照)。
* **Update**: 安卓上选照片不再经过会去掉位置的系统照片选择器，改为弹出「相机 / 文件」，经「文件」选的是带位置的原图；页面上有提示，见 [安卓上的位置](/product/features/upload.md#安卓上的位置)。

## 2026-11-10
* **Update**: 主题编辑、Living、上传三个页面组件拆成分区目录里的 Hook 与纯函数模块，页面只做编排，行为与 DOM 不变，见 [前端分区](/architecture/frontend.md)。
* **Update**: 提交前钩子对暂存文件跑格式化和 lint（能修的自动修），`npm install` / `npm ci` 后自动就位，CI 和没有 `.git` 的环境跳过，见 [提交前检查](/runbooks/local-dev.md#提交前检查)；新增浏览器冒烟测试 `npm run test:e2e`（构建后在独立的本地库上走一遍上传、发布和各页面，外加分块失效、会话过期、图库顺序、手机溢出、快速点击几条回归），PR 检查有单独的 e2e job，见 [冒烟测试](/runbooks/local-dev.md#冒烟测试)。
* **Update**: 页面刚加载完就点站内链接时，目标页不再卡在加载状态：共享 GET 缓存改用 `useSyncExternalStore` 订阅，见 [前端分区](/architecture/frontend.md)。
* **Update**: 照片上传在服务端拆成读表单、查询、写 R2、落库四步（`worker/lib/upload.ts`），注册设置移到 `worker/lib/settings.ts`，地点名称搜索移到 `searchPlaces`，路由之间不再互相引用，见 [照片接口](/api/photos.md)。
* **Update**: Lint 开启 React Hooks 与无障碍规则，`vp check` 保持零告警，见 [工具链采用 Vite+](/architecture/decisions/0006-vite-plus.md)。
* **Update**: 地图页切换城市时，新地图在图集画出后立即淡入，不再等满 6 秒，见 [地图](/product/features/map.md)。
* **Update**: 输入长度上限集中定义在 `shared/limits.ts`，后端校验和前端的 maxLength、提示文案都引用它，数值不变，见 [接口约定](/api/conventions.md)。
* **Update**: 地点与逆地理缓存从 KV 移到 D1 的 place_cache 表，每小时清理过期行；KV 每天 1000 次写入只留给会话和登录限流，批量上传不再导致当天无法登录，见 [place_cache](/data/place-cache.md)。
* **Update**: 新增隐私区域时，本人坐标落在区域内的已有照片一并改为隐藏位置，设置页显示改了几张；位置精度 fuzzy 的照片对他人不再返回到地点的距离，见 [隐私](/product/features/privacy.md)。
* **Update**: 照片列表超过 5000 张时响应带 truncated，图库、地图、索引显示「只显示最近的 5000 张」，见 [照片接口](/api/photos.md)。
* **Update**: 上传时多选的照片可以一起选地点（候选取各自匹配结果的并集，离得太远的不套用），队列里一键选中同一处拍的一组，见 [上传与整理](/product/features/upload.md#一起选地点)。
* **Update**: 上传页同时处理两张照片（实测 20 张 2400 万像素从 21 秒降到 12 秒），已填的内容按文件存为草稿、刷新后重新加入同样的文件自动恢复，见 [上传与整理](/product/features/upload.md#草稿)。
* **Update**: 字体改为自托管（宋体按 unicode-range 切片、只带用到的字重，字体样式表不阻塞渲染），界面改用系统黑体，不再请求 Google Fonts，见 [前端分区](/architecture/frontend.md)。
* **Update**: 接口有了路由测试：`npm run test:routes` 在本地 D1、R2、KV 上跑可见性矩阵、账号、上传、照片、主题、标签、地点和站点管理，PR 检查会跑它，不进 `npm run build`，见 [路由测试](/runbooks/local-dev.md#路由测试)；顺带修了地点别名以字符串提交时不去重、不限 20 个的问题。
* **Update**: 小字的三级墨加深到在纸面和卡纸上都不低于 4.5:1；小地图的署名加载后收成 ⓘ，见 [前端分区](/architecture/frontend.md)。
* **Update**: 图库、个人主页和地点页的瀑布流改成按行排列（第一行是最新的几张），分段渲染，返回时恢复已渲染的照片和滚动位置，见 [图库](/product/features/gallery.md)。
* **Update**: 手机版面：页眉一行，导航移到底部固定栏；图库和地图的筛选收进「筛选」按钮；标签管理每个标签一行，操作收进「更多」，见 [前端分区](/architecture/frontend.md)。
* **Update**: 页面、静态资源、`/api`、`/media` 响应加上 nosniff、Referrer-Policy，页面禁止被 iframe 嵌入，见 [Cloudflare 资源](/architecture/cloudflare.md)。
* **Update**: 发布后旧页面取不到分块时整页重新加载一次，仍失败则显示可刷新的错误状态，不再白屏，见 [前端分区](/architecture/frontend.md)。
* **Update**: 会话过期时就地弹出重新登录，填写的内容不丢；共享 GET 缓存 5 分钟后在挂载或回到标签页时后台刷新，见 [账号](/product/features/accounts.md)。

## 2026-11-08
* **Update**: 域名改为 Worker 路由 `living.ticoag.fun/*`，DNS 记录手动维护，不再使用自定义域名，见 [Cloudflare 资源](/architecture/cloudflare.md#资源)。
* **Update**: 上传页"全部发布（N）"取代"发布全部已匹配"：一键照原样发布队列里所有没发的照片，待确认和无位置的不关联地点；刚拖进来就能点，处理和匹配完的照片依次发出，结束后报告发了几张、几张已存在、几张失败，见 [全部发布](/product/features/upload.md#全部发布)。
* **Update**: 上传队列可以多选（勾选框、Ctrl/⌘、Shift、全选），选中两张以上时右栏变成"已选 N 张"，一起改标签、公开范围、位置精度和主题，部分照片才有的标签虚线显示，可"发布所选"；"标签和设置套用到其余 N 张"去掉，见 [一起整理](/product/features/upload.md#一起整理)。照片处理中也能填表。
* **Update**: 已选标签显示在标签搜索框里，回车添加第一个匹配、↑ ↓ 选择、退格去掉最后一个；队列每行显示已匹配的地点名和标签名，见 [多层级标签](/product/features/hierarchical-tags.md#打标签)。
* **Update**: 上传页紧凑化：有照片后标题和拖放区缩成一行，三栏工作区在 1180 像素以上正好占满窗口，页面不再滚动，各栏自己滚动，发布按钮固定在右栏底部；预览限高，拍摄信息压成两行，表单改成标签在左，见 [上传与整理](/product/features/upload.md#版面)。
* **Update**: 标签改成标签板：所有标签按 题材 / 光与天气 / 季节 / 色调 一行一行摆出，点一下即选；季节、光线、色调各只能选一个；搜索框筛选并可直接新建；"套用到其余"也带上标签。去掉了自动建议标签和 `suncalc`，见 [多层级标签](/product/features/hierarchical-tags.md#打标签)。
* **Update**: 搜索地点时结果按 A、B、C 标在地图上，没有 GPS 的照片也会出现地图，见 [地点匹配](/product/features/poi-matching.md#界面)。
* **Update**: 地图改为图集（小图册）：所有带位置的照片都上地图，包括没有匹配地点的；缩小时按省，放大依次按市、区县、地点直到单张，挤在一起的合并并按组成命名（整市 → 杭州，部分 → 西湖区等地，跨省 → 浙江等地）；圆片轮播最多 4 张、叠层表示一组、标签写名称和数量，当前层级的行政区边界画成虚线；点击区域放大到它拆开的那一级，侧栏列出下一层的组成；`?area=浙江,杭州` 选中区域。原来的数字聚合标记去掉，见 [地图](/product/features/map.md)。
* **Update**: 照片记录省份（迁移 `0003_photo_province.sql`），地点匹配返回 `province`，上传时写入；照片列表返回 `province` 和 `district`；Nominatim 缺地级市时以 zoom 7 再查一次，乡镇不再被当成城市，县级市归入区县，见 [photos](/data/photos.md#省市区县) 和 [地点接口](/api/pois.md#post-apipoismatch-登录)；逆地理缓存键改为 `geo:rev2:`，见 [KV](/data/kv.md)。
* **Creation**: 每小时的定时任务（Cron 触发器）补全没有省份的照片，包括之前上传的，见 [Cloudflare 资源](/architecture/cloudflare.md#定时任务)。
* **Update**: 地点匹配改用真实地图：拍摄位置、匹配半径、镜头朝向和编号候选都画在地图上，点编号即可选中，见 [地点匹配](/product/features/poi-matching.md)。
* **Update**: 附近地点改用免费的 Photon（线上从 Workers 请求 Overpass 全部超时，Overpass 改作后备），列出半径内所有带名称的地点；名称搜索在有坐标时只找照片附近约 6 千米；上传页不再显示"进入 Living"和"收藏"，见 [地点匹配](/product/features/poi-matching.md) 和 [地点接口](/api/pois.md)。
* **Update**: 带内容哈希的 `/assets/*` 让浏览器缓存一年（`public/_headers`）；各层缓存整理在 [Cloudflare 资源](/architecture/cloudflare.md#缓存)。
* **Update**: 第一批单元测试（41 个文件、931 个测试），`npm run build` 和 PR 检查都会跑，见 [本地开发](/runbooks/local-dev.md#单元测试)；顺带修了坐标显示偶尔出现 60″ 的问题，以及高德类别匹配的先后顺序。
* **Update**: MapLibre GL 升级到 6（修复 GHSA-jrc7-96c5-q579），Worker 由 Vite 单独构建，见 [前端分区](/architecture/frontend.md)。
* **Update**: Safari 以外的浏览器也能上传 HEIC：浏览器解不开时，用 libheif 的 WebAssembly 构建在 Worker 里解码，只在需要时加载，见 [上传](/product/features/upload.md) 和 [决策：浏览器端处理图片](/architecture/decisions/0002-client-side-images.md)。
* **Update**: 地图页把相近的地点合并成带数字的聚合标记，点击放大展开，见 [地图](/product/features/map.md)；被筛掉的标记改由 MapLibre 设置透明度，地点页上的淡化终于生效。
* **Update**: 地点可以编辑：创建者和站长、管理员在 `/studio/place/:id` 修改名称、类别、别名和匹配半径；接口只返回 `canEdit`，不返回创建者，见 [地点](/product/features/places.md) 和 [地点接口](/api/pois.md)。
* **Update**: 自建地点在被公开且显示位置的照片使用前，只出现在创建者自己的匹配和搜索里，见 [pois 的隐私](/data/pois.md#隐私)。
* **Update**: 工具链迁到 Vite+，开发服务器内运行 Worker，PR 上增加 GitHub Actions 检查，见 [决策：Vite+](/architecture/decisions/0006-vite-plus.md)；同步 [本地开发](/runbooks/local-dev.md)、[部署](/runbooks/deploy.md)、[构建与发布](/architecture/ci-cd.md) 和 [前端分区](/architecture/frontend.md)。
* **Update**: 静态资源设为 `html_handling: none`，修复 `/index` 整页加载被重定向到首页，见 [决策：单个 Worker](/architecture/decisions/0001-single-worker.md)。
* **Creation**: 建立知识包：[产品愿景](/product/vision.md)、[功能清单](/product/features/)、[架构总览](/architecture/overview.md)、[Cloudflare 资源](/architecture/cloudflare.md)、[构建与发布](/architecture/ci-cd.md)、[接口约定](/api/conventions.md)。
* **Creation**: 在 Cloudflare 账号下创建 Worker `living`、D1 `living`、R2 `living-photos`、KV `living-kv`，绑定 `living.ticoag.fun`，连接 GitHub 仓库 `ticoAg/Living`。
* **Initialization**: 设计稿见 [设计画布](/product/vision.md#设计稿)。
* **Creation**: 数据层文档 [数据](/data/)：[数据模型总览](/data/overview.md)、十张 D1 表（从 [users](/data/users.md) 到 [settings](/data/settings.md)）、[KV](/data/kv.md)、[R2 媒体文件](/data/media.md) 和 [预置标签](/data/preset-tags.md)，表结构与迁移文件逐列核对过。
* **Creation**: [决策记录](/architecture/decisions/)：[单个 Worker](/architecture/decisions/0001-single-worker.md)、[浏览器端处理图片](/architecture/decisions/0002-client-side-images.md)、[地点数据源](/architecture/decisions/0003-poi-providers.md)、[认证与邀请制](/architecture/decisions/0004-auth.md)、[文档采用 OKF](/architecture/decisions/0005-okf-docs.md)。
* **Creation**: [运行手册](/runbooks/)：[本地开发](/runbooks/local-dev.md)、[部署](/runbooks/deploy.md)、[密钥与初始化](/runbooks/secrets.md)。
* **Creation**: 仓库根目录 `README.md`，指向快速开始、部署和本知识包。
