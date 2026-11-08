# Directory Update Log

## 2026-11-08
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
