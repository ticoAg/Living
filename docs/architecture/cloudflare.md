---
type: Infrastructure
title: Cloudflare 资源
description: Living 在 Cloudflare 账号 6f12e69d… 下使用的 Worker、D1、R2、KV、域名路由、构建配置与每小时的定时任务。
tags: [architecture, cloudflare]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
  - resource: https://github.com/ticoAg/Living/blob/main/public/_headers
    title: 静态资源响应头
---
# 资源

| 资源 | 名称 | 标识 | 绑定名 |
|---|---|---|---|
| 账号 | Songhaoyang0523@gmail.com's Account | `6f12e69d95b961f8dcfc1fa867859b75` | — |
| Worker | `living` | tag `5d0c1ed87f534bb689e0287cd1205771` | — |
| D1 | `living` | `4024f786-2178-4cb7-ac52-040715a2798b` | `DB` |
| R2 | `living-photos` | — | `MEDIA` |
| KV | `living-kv` | `37fae53ace6d479380c48980477aa176` | `KV` |
| 静态资源 | `./dist` | — | `ASSETS` |
| 域名 | `living.ticoag.fun`，Worker 路由 `living.ticoag.fun/*`；DNS 记录（A）在区域里手动维护 | 区域 `c823bc358d7a051de8df8cb19c6d2736` | — |
| Git 连接 | GitHub `ticoAg/Living` | 连接 `698a6c91-dcf8-461c-a196-797ace8fc0c9` | — |

`workers.dev` 与预览地址关闭，只通过这个域名访问。路由写在 `wrangler.jsonc` 的 `routes`（带 `zone_id`），每次部署照此更新；不用自定义域名（`custom_domain`），因为它要求由 Worker 托管 DNS 记录，主机名已有手动记录时部署会报错 `100117`。可观测性（Workers Logs）开启。

# 定时任务

`wrangler.jsonc` 的 `triggers.crons` 设为 `23 * * * *`：每小时第 23 分钟，Worker 的 `scheduled` 处理函数（`worker/index.ts`）做两件互不影响的事，一件失败不妨碍另一件。

补全照片的省份（`worker/lib/regions.ts`）：

- 每次随机取最多 8 张还没有省份、有坐标（自己的或所在地点的）的照片，逐张逆地理编码，两张之间停 2.2 秒（Nominatim 要求每秒最多一次请求，一次查询可能要两次请求）。
- 写入 `province`，`city`、`district` 只在为空时填写；查不到省份的写 `''`；外部服务出错的留到下一小时。规则见 [photos](/data/photos.md#省市区县)。
- 与地点匹配共用数据源和逆地理缓存 `geo:rev2:`（D1 的 [place_cache](/data/place-cache.md)），配置了 `AMAP_KEY` 时中国境内用高德。

清理地点缓存（`worker/providers/cache.ts`）：

- 删除 [place_cache](/data/place-cache.md) 里已过期的行，按 `expires_at` 的索引查找。读缓存时过期行本来就算未命中，清理只是不让表无限变大。

其他：

- 结果写进 Workers Logs：`regions {"filled":…,"empty":…,"failed":…}` 和 `place cache {"purged":…}`。本地开发时用 `curl "http://localhost:5173/cdn-cgi/handler/scheduled"` 触发一次。
- Cron 触发器在免费版里不另外计费，每次运行算一次请求。

# 变量与密钥

| 名称 | 类型 | 用途 |
|---|---|---|
| `SITE_NAME` | 变量 | 站点名，默认 Living |
| `SITE_URL` | 变量 | `https://living.ticoag.fun` |
| `AMAP_KEY` | 密钥（可选） | 高德 Web 服务 Key；未设置时地点匹配使用 OpenStreetMap |

配置方法见 [密钥与初始化](/runbooks/secrets.md)。

# 缓存

| 内容 | 边缘 | 浏览器 |
|---|---|---|
| 页面（`index.html`）和 `favicon.svg` | Workers 静态资源自动缓存 | `max-age=0, must-revalidate`：每次用 ETag 确认，发布后立刻看到新版 |
| `/assets/*`（文件名带内容哈希的 JS、CSS、Worker） | 同上 | `public/_headers` 设为一年、`immutable`，不再回源确认 |
| `/media/` 下的公开尺寸图 | Worker 用 Cache API 存一份，命中时不读 D1 和 R2；照片改为私密或删除时清除当前机房的副本 | 一年、`immutable`：尺寸图只在上传时写入，之后不再改写 |
| 原图、私密照片的尺寸图 | 不缓存 | `private, no-store` |
| 列表接口（照片、标签、地点、主题） | 不缓存 | 未登录 `public, max-age=30`，登录后 `private, no-store`，都带 `Vary: Cookie` |
| 其他接口 | 不缓存 | `no-store` |

静态资源请求不调用 Worker，不占请求额度。构建缓存另见 [构建与发布](/architecture/ci-cd.md)。

# 安全响应头

| 响应头 | 值 | 页面与静态文件 | `/api` | `/media` |
|---|---|---|---|---|
| `X-Content-Type-Options` | `nosniff` | ✓ | ✓ | ✓ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✓ | ✓ | ✓ |
| `Content-Security-Policy` | `frame-ancestors 'none'`（不允许被其他网站用 iframe 嵌入） | ✓ | — | — |

- 页面与静态文件的响应头写在 `public/_headers` 的 `/*` 规则里，和 `/assets/*` 的缓存规则叠加生效。
- `/api` 由 `worker/index.ts` 的中间件统一加；`/media` 在 `worker/routes/media.ts` 里加，包括从 R2 读出的响应、Cache API 命中的副本和命中后的 304（缓存里的旧副本没有这些头，返回前补上）。
- 不设完整的内容安全策略：地图的 Worker、内联样式和 `data:` 占位图都要放行，配错会让站点打不开。

# 费用

全部在免费额度内可运行，照片多了以后主要成本是 R2 存储。各项免费额度每天 UTC 0 点重置，超出后对应的操作直接报错，不会自动计费：

| 服务 | 免费额度 | 用在哪里 |
|---|---|---|
| Workers | 每天 10 万次请求 | 每次 `/api`、`/media` 请求和每次定时任务 |
| D1 | 5 GB（单库 500 MB）；每天 500 万行读取、10 万行写入 | 全部表，包括地点缓存 [place_cache](/data/place-cache.md)：每写一条缓存约记 3 行（连同索引） |
| R2 | 10 GB 存储，无出站流量费 | 原图与尺寸图 |
| KV | 每天 10 万次读、1000 次写、1000 次删除 | 只有会话和登录限流，见 [KV](/data/kv.md) |

KV 的写入额度最紧：会话写不进去时登录和注册返回 500，当天无法登录。所以 KV 只放会话和登录限流（每天约 500 次成功登录才会用完），地点与逆地理缓存放在 D1，批量上传再多照片也不占 KV 的写入。
