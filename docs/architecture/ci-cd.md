---
type: Pipeline
title: 构建与发布
description: PR 上由 GitHub Actions 跑 Vite+ 的检查、测试和构建；合并到 main 后 Cloudflare Workers Builds 自动检查、测试、构建、执行 D1 迁移并部署，启用构建缓存。
tags: [architecture, cloudflare, ci]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/.github/workflows/ci.yml
    title: PR 检查
  - resource: https://github.com/ticoAg/Living/blob/main/package.json
    title: 脚本
---
# PR 检查

`.github/workflows/ci.yml` 在每个 PR 上运行，Node 版本取 `.node-version`：

| 步骤 | 命令 |
|---|---|
| 安装 | `npm ci` |
| 格式、lint、类型检查 | `npx vp check` |
| 测试 | `npx vp test` |
| 构建 | `npx vp build` |

# 部署触发

| 项 | 值 |
|---|---|
| 仓库 | `ticoAg/Living` |
| 分支 | `main`（推送或合并 PR 即触发） |
| 根目录 | `/` |
| 构建命令 | `npm run build`（= `vp check --no-fmt`、`vp test`、`vp build`） |
| 部署命令 | `npx wrangler d1 migrations apply living --remote && npx wrangler deploy` |
| Node | `.node-version`（24） |
| 构建缓存 | 开启（缓存依赖与构建产物） |

Workers Builds 会在构建前按 `package-lock.json` 自动安装依赖。部署前的构建不检查格式：格式问题在 PR 检查里拦下，不阻塞已经合并的修复上线。

# 流程

1. 在功能分支开发，提交 PR，等 PR 检查通过。
2. 合并到 `main` → Workers Builds 拉取代码 → 安装依赖 → `npm run build`。
3. `vp build` 用 [Cloudflare Vite 插件](/architecture/decisions/0006-vite-plus.md) 输出 `dist/client/`（静态资源）和 `dist/living/`（Worker 与生成的 `wrangler.json`），并写入 `.wrangler/deploy/config.json`。
4. 部署命令经由这个文件读取构建出的配置：先对远端 D1 应用 `migrations/` 中尚未执行的迁移，再上传 Worker 与静态资源。
5. 构建日志在 Cloudflare 控制台 Workers & Pages › living › Deployments。

# 迁移约定

- 迁移文件只增不改，按 `NNNN_描述.sql` 编号。
- 迁移必须向后兼容上一版 Worker（先加列、后用列），因为迁移先于 Worker 发布执行。

# 本地

见 [本地开发](/runbooks/local-dev.md)。
