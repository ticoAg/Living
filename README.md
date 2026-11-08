# Living

旅行与生活的影像图库。上传照片，按 GPS 和镜头朝向自动匹配到具体地点（断桥、孤山……），用多层级标签整理，给每张照片写笔记，编成主题和游记，在地图上回看，或用 Living 模式全屏轮播。

线上地址：<https://living.ticoag.fun>

## 技术栈

| 层     | 选择                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------- |
| 前端   | React 19、wouter；MapLibre（OpenFreeMap 瓦片）；`exifr`、`thumbhash`                            |
| 工具链 | Vite+（Vite 8、Rolldown、Vitest、Oxlint、Oxfmt）；Cloudflare Vite 插件在开发服务器里运行 Worker |
| 后端   | Cloudflare Worker + Hono；同一个 Worker 提供静态资源、`/api` 和 `/media`                        |
| 数据   | D1（SQLite）、R2（原图与尺寸图）、KV（会话与缓存）                                              |
| 图片   | 浏览器端解码、缩放、生成 ThumbHash 与 SHA-256，Worker 只校验和存储                              |
| 发布   | GitHub 推送 `main`，Cloudflare Workers Builds 自动构建、迁移、部署                              |

## 仓库结构

```
src/            React 单页应用：pages/ 页面，components/ 组件，lib/ 请求与工具，styles/ 样式
worker/         Cloudflare Worker：Hono 路由，D1、R2、KV 访问
shared/         前后端共用的接口类型与地理计算（types.ts、geo.ts）
migrations/     D1 迁移，只增不改
docs/           知识包：产品、架构、数据、接口、运行手册
public/         原样复制到 dist/client/ 的静态文件
wrangler.jsonc  Worker、D1、R2、KV、域名配置
```

## 快速开始

需要 Node.js 22.18 以上或 24。不需要 Cloudflare 账号，本地用模拟的 D1、R2、KV。

```bash
npm install
npm run db:migrate:local   # 建本地数据库，写入预置标签
npm run dev                # http://localhost:5173：页面、/api、/media 和本地 D1、R2、KV
```

第一次使用还要写入站长邀请码才能注册，完整步骤见 [本地开发](docs/runbooks/local-dev.md)。

其他常用命令：

| 命令                       | 作用                                 |
| -------------------------- | ------------------------------------ |
| `npm run check`            | 格式、lint 和类型检查（`vp check`）  |
| `npm test`                 | 单元测试（`vp test`）                |
| `npm run build`            | 检查、测试加构建，与线上构建命令相同 |
| `npm run db:migrate:local` | 对本地 D1 应用迁移                   |

## 部署

PR 上由 GitHub Actions 跑检查、测试和构建；合并到 `main` 即由 Workers Builds 构建并部署，部署命令会先对线上 D1 应用新迁移。流程见 [构建与发布](docs/architecture/ci-cd.md)；日志、手动部署、回滚见 [部署](docs/runbooks/deploy.md)；高德 Key 和站长邀请码见 [密钥与初始化](docs/runbooks/secrets.md)。

## 文档

文档在 [`docs/`](docs/index.md)，按 [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.2 组织：每个文件讲一个概念，frontmatter 的 `type` 标明种类，`index.md` 是目录，`log.md` 记录变更。

| 想知道                   | 看                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------ |
| 做什么、为谁做           | [产品](docs/product/index.md)                                                        |
| 系统怎么搭、为什么这样选 | [架构](docs/architecture/index.md)、[决策记录](docs/architecture/decisions/index.md) |
| 表、KV、R2 的结构        | [数据](docs/data/index.md)                                                           |
| HTTP 接口                | [接口](docs/api/index.md)                                                            |
| 怎么跑、怎么发布         | [运行手册](docs/runbooks/index.md)                                                   |

修改迁移、类型或接口时，同一个 PR 里更新对应文档，见 [决策：文档采用 OKF](docs/architecture/decisions/0005-okf-docs.md)。
