# Directory Update Log

## 2026-11-08
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
