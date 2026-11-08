---
type: Runbook
title: 本地开发
description: 安装依赖、建本地 D1、写入站长邀请码，用 wrangler 和 Vite 在本机跑起完整站点。
tags: [runbook, dev]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/package.json
    title: 脚本
  - resource: https://github.com/ticoAg/Living/blob/main/vite.config.ts
    title: 开发代理
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 前提

- Node.js 20 或更高，以及 npm。
- 不需要登录 Cloudflare。`wrangler dev` 默认用本机模拟的 D1、R2、KV，数据保存在 `.wrangler/state/`（已在 `.gitignore` 里），不会碰线上数据。

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

4. 构建一次前端，生成 `dist/`。`wrangler.jsonc` 的 `assets.directory`（`./dist`）必须存在，否则下一步会报错退出：

   ```bash
   npx vite build
   ```

5. 启动 Worker（接口、媒体和静态资源），监听 8787：

   ```bash
   npm run dev:api
   ```

6. 另开一个终端启动前端，监听 5173，并把 `/api` 和 `/media` 代理到 8787（见 `vite.config.ts`）：

   ```bash
   npm run dev
   ```

7. 打开 <http://localhost:5173/register>，邀请码填第 3 步的 `<code>`。注册的第一个账号就是站长；之后在"设置"里生成普通邀请码，见 [站点管理](/product/features/admin.md)。

# 日常

| 做什么 | 怎么做 |
|---|---|
| 改前端 | 保存即热更新（Vite，5173） |
| 改 Worker | wrangler 自动重载（8787） |
| 看最新的前端构建 | 重新 `npx vite build`，直接访问 8787 看到的是 `dist/` 里上次构建的产物；日常开发用 5173 |
| 类型检查 | `npm run typecheck`，分别检查 `src` 加 `shared` 与 `worker` 加 `shared` |
| 完整构建 | `npm run build`，类型检查加 `vite build`，与线上构建命令相同 |
| 新增迁移 | `npx wrangler d1 migrations create living <描述>`，写好后 `npm run db:migrate:local`，规则见 [部署](/runbooks/deploy.md) |

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

重启 `npm run dev:api` 生效。Key 的申请见 [密钥与初始化](/runbooks/secrets.md)。

# 常见问题

| 现象 | 原因与处理 |
|---|---|
| `wrangler dev` 报 `assets.directory` 不存在 | 还没构建，执行 `npx vite build` |
| 在 5173 上请求 `/api` 连接被拒绝 | Worker 没启动，先 `npm run dev:api` |
| 注册提示邀请码无效 | 邀请码没写进本地库，或写进了线上库（命令里要带 `--local`）；用 `npx wrangler d1 execute living --local --command "SELECT code, role, used_at FROM invites"` 查看 |
| 登录后马上回到未登录 | 用 `http://localhost:5173` 访问，不要用局域网 IP：会话 Cookie 带 `Secure`，浏览器只对 `localhost` 这样的可信来源在 http 下保存它 |
| 改了 `dev:api` 的端口后前端请求失败 | 同步修改 `vite.config.ts` 里的代理地址 |
| 地点匹配没有候选 | 本地要访问外部服务：OpenStreetMap 的 Overpass 和 Nominatim，或高德；离线时只有站内地点 |
