---
type: Decision
title: 工具链采用 Vite+，开发服务器内运行 Worker
description: 用 Vite+（Vite 8、Rolldown、Vitest、Oxlint、Oxfmt）统一开发、检查、测试和构建；Cloudflare Vite 插件让开发服务器直接运行 Worker 和本地 D1、R2、KV。
tags: [decision, tooling, frontend, cloudflare]
status: stable
decided: 2026-11-08
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/vite.config.ts
    title: Vite+ 配置
  - resource: https://viteplus.dev/guide/
    title: Vite+ 文档
  - resource: https://developers.cloudflare.com/workers/vite-plugin/
    title: Cloudflare Vite 插件
---
# 背景

最初的工具链是 Vite 7 构建前端、`tsc` 分别检查前端和 Worker、`wrangler dev` 单独运行 Worker；本地开发要开两个终端，前端把 `/api` 和 `/media` 代理到 8787。没有 lint、格式化和测试。

# 决定

- 开发依赖 `vite-plus`（版本锁定），`vite` 通过 `overrides` 指向同版本的 `@voidzero-dev/vite-plus-core`。命令统一为 `vp dev`、`vp check`、`vp test`、`vp build`，`package.json` 的脚本只是它们的组合。
- 配置都在 `vite.config.ts`：`fmt`（Oxfmt：单引号、无尾随逗号、行宽 140；CSS 和 `docs/` 不格式化）、`lint`（Oxlint，开启 `typeAware` 和 `typeCheck`，由 tsgolint 做类型检查）、`test`（Vitest，`*.test.ts` 与被测模块放在一起，Node 环境）。
- 类型检查按就近的 `tsconfig.json` 进行，所以 Worker 的配置放在 `worker/tsconfig.json`（Workers 类型），前端和 `shared/` 用根目录的配置。
- `@cloudflare/vite-plugin` 在开发服务器里用 workerd 运行 `worker/index.ts`，绑定取自 `wrangler.jsonc`，本地数据在 `.wrangler/state/`。`vp build` 同时构建前端和 Worker，输出 `dist/client/` 与 `dist/living/`，`wrangler deploy` 和 `wrangler d1 migrations` 通过 `.wrangler/deploy/config.json` 读取构建出的配置。
- 部署前的构建命令是 `vp check --no-fmt && vp test && vp build`；PR 上的 GitHub Actions 跑完整的 `vp check`、`vp test`、`vp build`，见 [构建与发布](/architecture/ci-cd.md)。

# 后果

- 一条 `npm run dev` 跑起完整站点；本地和线上用同一个 workerd 运行时，静态资源规则（`html_handling`、`run_worker_first`）在开发时也生效。
- Rolldown 构建明显更快；lint 和类型检查一次完成，类型错误、lint 错误和失败的测试都会阻止部署。
- 依赖 VoidZero 的发布节奏：`vite-plus` 锁定版本，升级时同时更新 `overrides` 并跑一遍 `vp check`、`vp test`、`vp build` 和本地端到端检查。
- `vp build` 的输出结构变了：Worker 由 Vite 打包，不再由 wrangler 的 esbuild 打包；`wrangler.jsonc` 里的 `assets.directory` 只在不经过 Vite 直接运行 wrangler 时使用。
- 需要 Node `^22.18.0`、`^24.11.0` 或 26 以上；`.node-version` 设为 24，与 Workers Builds 的默认版本一致。

# 备选

- **保持 Vite + tsc + wrangler dev**：能用，但两个开发进程、没有 lint 和测试，配置分散。
- **Vite+ 但不用 Cloudflare 插件**：仍需 `wrangler dev` 和代理，开发时跑的 Worker 与构建产物不是同一条构建链。
- **ESLint + Prettier + Vitest 各自配置**：生态成熟，但配置和依赖更多，速度明显更慢。
