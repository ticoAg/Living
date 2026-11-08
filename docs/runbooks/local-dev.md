---
type: Runbook
title: 本地开发
description: 安装依赖、建本地 D1、写入站长邀请码，用 Vite+ 一条命令在本机跑起前端、Worker 和本地 D1、R2、KV。
tags: [runbook, dev]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/package.json
    title: 脚本
  - resource: https://github.com/ticoAg/Living/blob/main/vite.config.ts
    title: Vite+ 配置
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 前提

- Node.js 22.18 以上或 24（`.node-version` 写的是 24），以及 npm。工具链是 [Vite+](/architecture/decisions/0006-vite-plus.md)，作为开发依赖装在项目里，不需要全局安装 `vp`。
- 不需要登录 Cloudflare。开发服务器用本机模拟的 D1、R2、KV，数据保存在 `.wrangler/state/`（已在 `.gitignore` 里），不会碰线上数据。

# 第一次启动

1. 安装依赖：

   ```bash
   npm install
   ```

2. 建本地数据库，应用 `migrations/` 下的全部迁移，包括 [预置标签](/data/preset-tags.md)：

   ```bash
   npm run db:migrate:local
   ```

3. 写入站长邀请码。本地库里还没有用户，只有 `owner` 邀请码能注册，原因见 [决策：认证](/architecture/decisions/0004-auth.md)。`<code>` 本地随便取，例如 `openssl rand -hex 8` 的输出：

   ```bash
   npx wrangler d1 execute living --local --command "INSERT INTO invites (code, role, note) VALUES ('<code>','owner','bootstrap')"
   ```

4. 启动开发服务器，监听 5173。Cloudflare 的 Vite 插件在同一个进程里用 workerd 运行 `worker/index.ts`，页面、`/api`、`/media` 和本地 D1、R2、KV 都由它提供：

   ```bash
   npm run dev
   ```

5. 打开 <http://localhost:5173/register>，邀请码填第 3 步的 `<code>`。注册的第一个账号就是站长；之后在"设置"里生成普通邀请码，见 [站点管理](/product/features/admin.md)。

# 日常

| 做什么 | 怎么做 |
|---|---|
| 改前端 | 保存即热更新 |
| 改 Worker | 保存后开发服务器自动重载 Worker |
| 检查 | `npm run check`，即 `vp check`：格式、Oxlint（含类型感知规则）和类型检查一起跑 |
| 自动修复 | `npx vp check --fix`，格式化并应用能自动修复的 lint 规则 |
| 测试 | `npm test`，即 `vp test`（Vitest）；监听模式用 `npx vp test watch` |
| 完整构建 | `npm run build`，即 `vp check --no-fmt`、`vp test`、`vp build`，与线上构建命令相同 |
| 预览构建产物 | `npm run build` 后 `npx vp preview`，在 workerd 里运行构建出的 Worker |
| 新增迁移 | `npx wrangler d1 migrations create living <描述>`，写好后 `npm run db:migrate:local`，规则见 [部署](/runbooks/deploy.md) |
| 跑一次定时任务 | 开发服务器运行时 `curl "http://localhost:5173/cdn-cgi/handler/scheduled"`，补全本地照片的省份，见 [定时任务](/architecture/cloudflare.md#定时任务) |

格式与 lint 的设置都在 `vite.config.ts` 的 `fmt` 和 `lint` 里：单引号、不加尾随逗号、行宽 140；CSS 保持一条规则一行，`docs/` 不格式化。类型检查按就近的 `tsconfig.json` 进行：`worker/` 用 `worker/tsconfig.json`（Workers 类型），其余用根目录的 `tsconfig.json`。

# 单元测试

纯逻辑有单元测试：坐标换算、标签树、输入校验、地点匹配、可见性与位置隐私等。测试文件与源码放在一起，命名为 `*.test.ts`，范围见 `vite.config.ts` 的 `test.include`：

```bash
npm test                 # 跑一遍
npx vp test watch        # 监听模式，改动后自动重跑
npx vp test shared/geo   # 只跑路径里含 shared/geo 的测试文件
```

- 测试在 Node 里运行，不需要先构建或启动开发服务器：`mode` 为 `test` 时 `vite.config.ts` 不加载 Cloudflare 插件。
- 不碰真实的 D1、R2、KV 和外部服务。`worker/test-utils.ts` 提供内存里的 D1、KV 替身，`fetch` 在测试里用 `vi.stubGlobal` 替换。
- 涉及日期的测试用本地日期字段构造（如 `new Date(2026, 10, 8)`），结果不随机器时区变化。
- `npm run build` 会先跑检查和测试，有一项失败就不会构建。

# 重置本地数据

删除 `.wrangler/state/` 会清空本地的 D1、R2 和 KV，然后重做第 2、3 步：

```bash
rm -rf .wrangler/state
npm run db:migrate:local
```

# 可选：使用高德

本地默认用 OpenStreetMap 匹配地点。要用高德，在仓库根目录建 `.dev.vars`（已被 `.gitignore` 忽略）：

```
AMAP_KEY=你的高德 Web 服务 Key
```

重启 `npm run dev` 生效。Key 的申请见 [密钥与初始化](/runbooks/secrets.md)。

# 常见问题

| 现象 | 原因与处理 |
|---|---|
| `npm install` 或 `vp` 提示 Node 版本不支持 | Vite+ 需要 Node `^22.18.0`、`^24.11.0` 或 26 以上，换成 `.node-version` 里的 24 |
| 注册提示邀请码无效 | 邀请码没写进本地库，或写进了线上库（命令里要带 `--local`）；用 `npx wrangler d1 execute living --local --command "SELECT code, role, used_at FROM invites"` 查看 |
| 登录后马上回到未登录 | 用 `http://localhost:5173` 访问，不要用局域网 IP：会话 Cookie 带 `Secure`，浏览器只对 `localhost` 这样的可信来源在 http 下保存它 |
| `/api` 报表不存在 | 本地库还没迁移，执行 `npm run db:migrate:local` |
| `npm run build` 停在检查或测试 | 先修 `npm run check` 和 `npm test` 报的问题；只是格式问题用 `npx vp check --fix` |
| 地点匹配没有候选 | 本地要访问外部服务：OpenStreetMap 的 Overpass 和 Nominatim，或高德；离线时只有站内地点 |
