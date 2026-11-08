---
type: Pipeline
title: 构建与发布
description: GitHub 仓库连接 Cloudflare Workers Builds，推送 main 时自动安装依赖、类型检查、构建、执行 D1 迁移并部署，启用构建缓存。
tags: [architecture, cloudflare, ci]
---
# 触发

| 项 | 值 |
|---|---|
| 仓库 | `ticoAg/Living` |
| 分支 | `main`（推送或合并 PR 即触发） |
| 根目录 | `/` |
| 构建命令 | `npm run build`（= `tsc` 类型检查 + `vite build`） |
| 部署命令 | `npx wrangler d1 migrations apply living --remote && npx wrangler deploy` |
| 构建缓存 | 开启（缓存依赖与构建产物） |

Workers Builds 会在构建前按 `package-lock.json` 自动安装依赖。

# 流程

1. 在功能分支开发，提交 PR。
2. 合并到 `main` → Workers Builds 拉取代码 → 安装依赖 → `npm run build`。
3. 部署命令先对远端 D1 应用 `migrations/` 中尚未执行的迁移，再上传 Worker 与 `dist/` 静态资源。
4. 构建日志在 Cloudflare 控制台 Workers & Pages › living › Deployments。

# 迁移约定

- 迁移文件只增不改，按 `NNNN_描述.sql` 编号。
- 迁移必须向后兼容上一版 Worker（先加列、后用列），因为迁移先于 Worker 发布执行。

# 本地

见 [本地开发](/runbooks/local-dev.md)。
