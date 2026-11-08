---
type: Runbook
title: 密钥与初始化
description: 配置高德 Web 服务 Key（AMAP_KEY），写入站长引导邀请码，以及邀请码的轮换与清理。
tags: [runbook, secrets, setup]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
  - resource: https://github.com/ticoAg/Living/blob/main/worker/env.ts
    title: Worker 绑定类型
---
# 变量与密钥

| 名称 | 类型 | 配置位置 | 必需 |
|---|---|---|---|
| `SITE_NAME`、`SITE_URL` | 变量 | `wrangler.jsonc` 的 `vars`，随代码发布 | 是 |
| `AMAP_KEY` | 密钥 | 本页下面两种方式之一 | 否：没有时地点匹配改用 OpenStreetMap |

会话、数据库和文件存储都通过绑定访问，不需要其他密钥。资源清单见 [Cloudflare 资源](/architecture/cloudflare.md)。

# 高德 Web 服务 Key

用途：地点匹配和逆地理编码，见 [决策：地点数据源](/architecture/decisions/0003-poi-providers.md)。

申请：

1. 在 [高德开放平台](https://lbs.amap.com/) 注册开发者，进入控制台的应用管理，创建应用。
2. 在应用下添加 Key，"服务平台"选 **Web 服务**。
3. 复制 Key。

写入线上，二选一：

- **wrangler**：`npx wrangler secret put AMAP_KEY`，按提示粘贴 Key（输入不回显）。脚本里可用 `printf '%s' "$KEY" | npx wrangler secret put AMAP_KEY`。这条命令会立即创建并部署一个新版本。
- **控制台**：Workers & Pages › living › Settings › Variables and Secrets › Add，类型选 **Secret**，变量名 `AMAP_KEY`，粘贴值，点 Deploy。

类型必须是 Secret。以文本变量形式添加的值，会在下一次 `wrangler deploy` 时被 `wrangler.jsonc` 里的配置覆盖掉；密钥则不会被部署删除。

验证：

```bash
curl -s https://living.ticoag.fun/api/site
```

返回里 `hasAmap` 为 `true`。之后在中国大陆范围内拍摄的照片，匹配结果的 `provider` 为 `amap`；境外照片仍用 OpenStreetMap。

本地开发时写在 `.dev.vars`，见 [本地开发](/runbooks/local-dev.md)。

更换与移除：

- 更换：再执行一次 `npx wrangler secret put AMAP_KEY`。
- 移除：`npx wrangler secret delete AMAP_KEY`，地点匹配回退到 OpenStreetMap。缓存按数据源分开，不会混用。
- Key 泄露：在高德控制台删除旧 Key，新建后按上面的步骤写入。Workers 的出口 IP 不固定，不要给 Key 设置 IP 白名单。

# 站长引导邀请码

新部署的数据库里没有用户，`GET /api/site` 返回 `needsSetup: true`，此时只有 `owner` 角色的邀请码能注册，注册者成为站长，见 [账号](/product/features/accounts.md)。

在首次部署成功之后（迁移已建好表）、把网址发给任何人之前：

1. 生成一个随机码并写入线上库，记下它：

   ```bash
   CODE=$(openssl rand -hex 8)
   echo "$CODE"
   npx wrangler d1 execute living --remote --command "INSERT INTO invites (code, role, note) VALUES ('$CODE','owner','bootstrap')"
   ```

   等价于 `... VALUES ('<code>','owner','bootstrap')`，`<code>` 要随机，不要用 `owner`、`admin` 这样好猜的值。

2. 打开 `https://living.ticoag.fun/register`，填邀请码、用户名、显示名和密码。注册成功的这个账号就是站长，`needsSetup` 随之变为 `false`，这个邀请码也已用掉。
3. 确认站长账号：

   ```bash
   npx wrangler d1 execute living --remote --command "SELECT handle, role FROM users"
   ```

4. 在"设置"里生成给朋友的普通邀请码，需要时把注册方式调为 `closed`，见 [站点管理](/product/features/admin.md)。

命令里的 `--remote` 作用于线上库，本地练习用 `--local`。

# 轮换与清理

| 场景 | 做法 |
|---|---|
| 站长引导邀请码泄露、但还没有被用 | `DELETE FROM invites WHERE role = 'owner' AND used_at IS NULL`，再按上面的步骤生成新的 |
| 清掉所有没用过的邀请码 | `DELETE FROM invites WHERE used_at IS NULL`；也可以在"设置"里逐个删除 |
| 查看有哪些邀请码 | `SELECT code, role, note, used_at, expires_at FROM invites ORDER BY created_at DESC` |
| 引导邀请码被别人抢先用掉 | 用 `DELETE FROM users WHERE handle = '…'` 删掉该账号（其数据级联删除），再生成新的引导邀请码 |

这些语句都通过 `npx wrangler d1 execute living --remote --command "…"` 执行。判断邀请码是否用过以 `used_at` 为准，原因见 [invites](/data/invites.md)。

# 不要提交的东西

`.dev.vars`、`.env` 已在 `.gitignore` 里。API 令牌、高德 Key、邀请码不要写进仓库、PR 描述、issue 或日志。
