---
type: Runbook
title: 部署
description: 推送 main 由 Workers Builds 自动构建、迁移并部署；包含查看日志、手动部署、回滚、数据库恢复和迁移规则。
tags: [runbook, deploy, cloudflare]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/package.json
    title: 脚本
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 自动部署（默认）

推送或合并到 `main` 会触发 Workers Builds：安装依赖，执行 `npm run build`（检查、测试、构建），再执行部署命令 `npx wrangler d1 migrations apply living --remote && npx wrangler deploy`。触发条件、构建缓存和各项设置见 [构建与发布](/architecture/ci-cd.md)。

发布前：

1. 本地 `npm run check` 和 `npm test` 通过；有新迁移时 `npm run db:migrate:local` 并在本地试一遍，见 [本地开发](/runbooks/local-dev.md)。
2. 提 PR，等 GitHub Actions 的检查通过后合并到 `main`。
3. 在控制台看构建结果（见下一节）。

发布后验证：

```bash
curl -s https://living.ticoag.fun/api/site
```

应返回 JSON，含 `name`、`registration`、`hasAmap`、`needsSetup`。再打开首页、任意一张照片和 `/map` 看是否正常。

失败时的行为：

- lint、类型检查、测试或 `vp build` 失败：不会部署，线上仍是上一个版本。
- 迁移失败：部署命令在这一步停止，Worker 不会更新。修复方法是新增一个迁移，不要改已经应用过的迁移文件。

# 查看日志

| 内容 | 位置 |
|---|---|
| 构建与部署日志 | 控制台 Workers & Pages › living › Deployments |
| 运行日志 | 控制台 Workers & Pages › living › Logs，即 Workers Logs（`wrangler.jsonc` 里已启用 `observability`），保留 7 天；也可以在 Observability 页面用查询构建器筛选 |
| 实时日志 | `npx wrangler tail living`；只看错误加 `--status error` |

# 手动部署（兜底）

Workers Builds 出问题或需要从本机紧急发布时：

```bash
npm ci
npm run build
CLOUDFLARE_API_TOKEN=… npm run deploy
```

- `npm run deploy` 先执行 `npm run build`，再执行 `wrangler d1 migrations apply living --remote && wrangler deploy`。
- `vp build` 生成 `dist/client/`（静态资源）和 `dist/living/`（Worker 与生成的 `wrangler.json`），并写入 `.wrangler/deploy/config.json`，之后的 `wrangler` 命令通过它读取构建出的配置，迁移目录仍指向 `migrations/`。没有构建就执行 `wrangler deploy` 会报错。
- `account_id` 已写在 `wrangler.jsonc`，不需要 `CLOUDFLARE_ACCOUNT_ID`。
- 令牌需要账号级的 Workers Scripts 编辑和 D1 编辑权限；首次部署或修改自定义域名、路由时，还要该区域的 Workers Routes 编辑权限。令牌只通过环境变量传入，不要写进仓库。

# 回滚

回滚到之前的 Worker 版本：

```bash
npx wrangler deployments list
npx wrangler rollback <version-id> -m "原因"
```

或在控制台 Workers & Pages › living › Deployments，点目标版本右侧的菜单选择 Rollback。

- 版本包含代码、静态资源和绑定配置，回滚会让前端和接口一起回到那个版本；只能回滚到最近 100 个版本。
- 回滚不改变 D1、R2、KV 里的数据，所以已应用的迁移不会撤销。迁移要求向后兼容，旧版本的 Worker 仍能在新表结构上运行，见下文。
- 回滚不会改动 git。`main` 上有问题的提交需要修复或回退，否则下一次推送会再次部署它。

# 数据库恢复

D1 的 Time Travel 可以把数据库恢复到过去任意一分钟，保留期免费版 7 天、付费版 30 天：

```bash
npx wrangler d1 time-travel info living --timestamp=<unix 秒或 RFC3339 时间>
npx wrangler d1 time-travel restore living --timestamp=<unix 秒或 RFC3339 时间>
```

恢复会覆盖当前数据库，命令会返回一个 bookmark，可以用来撤销这次恢复。Time Travel 只覆盖 D1，R2 里的文件和 KV 不在其中。

# 迁移规则

迁移文件在 `migrations/`，按 `NNNN_描述.sql` 编号，部署时先于 Worker 应用。

- **只增不改**：已经合并的迁移文件不再修改。要改表就新增一个迁移：`npx wrangler d1 migrations create living <描述>`。
- **向后兼容上一版 Worker**：先加列、后用列。加列必须可空或带常量默认值（SQLite 的限制）；删除或重命名列分两次发布：先发布不再使用它的代码，下一次迁移再删。
- **可重复执行**：用 `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`、`INSERT OR IGNORE`。
- **外键**：D1 强制外键；迁移中需要临时违反外键时，先执行 `PRAGMA defer_foreign_keys = true`。
- **预置数据**：新增预置标签这类数据写成迁移，id 一旦发布就不再改，见 [预置标签](/data/preset-tags.md)。
- **上线前**：在空的本地库上完整跑一遍（`rm -rf .wrangler/state && npm run db:migrate:local`）。
- **查看线上状态**：`npx wrangler d1 migrations list living --remote` 列出尚未应用的迁移。
- 改了表结构要同步 [数据](/data/) 里对应的文档，见 [决策：文档采用 OKF](/architecture/decisions/0005-okf-docs.md)。

# 常见问题

| 现象 | 处理 |
|---|---|
| 构建失败，报 lint、类型或测试错误 | 本地 `npm run check` 和 `npm test`，修好再推 |
| 构建报 Worker 名称不一致 | 控制台里的 Worker 名必须与 `wrangler.jsonc` 的 `name`（`living`）一致 |
| 依赖或构建产物像是旧的 | 控制台 Settings › Build › Build cache，点 Clear Cache 后重新构建 |
| `/api`、`/media` 返回 429，页面能打开 | 免费版每天 10 万次 Worker 调用用完了，UTC 0 点重置，见 [决策：单个 Worker](/architecture/decisions/0001-single-worker.md) |
| 线上出现 `Worker exceeded resource limits` | CPU 时间超限，多见于登录和注册的密码哈希，见 [决策：认证](/architecture/decisions/0004-auth.md) |
