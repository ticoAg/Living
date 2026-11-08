---
type: KV Namespace
title: KV 会话与缓存
description: 命名空间 living-kv：登录会话、登录限流计数、地点与逆地理缓存；都带过期时间，丢失无碍。
tags: [data, kv, cloudflare]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 命名空间

| 项 | 值 |
|---|---|
| 名称 | `living-kv` |
| 标识 | `37fae53ace6d479380c48980477aa176` |
| 绑定 | `KV` |

# 键

| 键 | 值 | TTL | 用途 |
|---|---|---|---|
| `sess:<token>` | JSON `{"userId":"u_…","createdAt":"…"}` | 30 天 | 登录会话 |
| `rl:login:<ip>:<handle>` | JSON `{"count":3,"resetAt":1790000000}` | 约 60 秒 | 登录限流 |
| `poi:near:<provider>:<lat4>:<lng4>:<radius>` | 外部地点候选列表（JSON） | 7 天 | 周边搜索缓存 |
| `geo:rev:<provider>:<lat3>:<lng3>` | 城市与区县（JSON） | 7 天 | 逆地理缓存 |

- `<token>`：32 字节随机数的 base64url，与 Cookie `living_session` 的值相同。退出登录时删除该键。
- `rl:login`：固定窗口计数，`resetAt` 是窗口结束的 Unix 秒。同一 IP 对同一用户名每分钟最多 5 次，超过返回 429；登录成功后删除该键。`<handle>` 统一转小写，因为用户名不区分大小写。60 秒是 KV 允许的最短过期时间。
- `<provider>`：`amap` 或 `osm`。配置了 `AMAP_KEY` 且坐标在中国大陆范围内用 `amap`，其余用 `osm`。缓存按数据源分开，设置或删除 `AMAP_KEY` 后不会读到另一个数据源的结果。
- `<lat4>` `<lng4>`：坐标四舍五入到 4 位小数，约 10 米网格；`<lat3>` `<lng3>` 取 3 位，约 100 米；`<radius>` 是搜索半径（米）。
- 外部请求失败时不写缓存；缓存读写出错都被忽略，不会让地点匹配失败。
- 键的约定来自 [认证接口](/api/auth.md)、[接口约定](/api/conventions.md) 和 [地点接口](/api/pois.md)。

# 一致性与配额

- KV 最终一致：写入在本数据中心立即可见，其他地方最长约 60 秒后可见。退出登录后，别处的节点最长约 60 秒内仍可能读到旧会话；并发登录时限流计数可能略小于真实次数，对挡住暴力猜测足够。
- 免费版每天 10 万次读、1000 次写（不同键）、1000 次删除，UTC 0 点重置，超出后该类操作报错。同一个键每秒最多写一次。
- 读主要来自带会话的接口请求（每次读一次 `sess:`）；写来自登录（一次限流计数加一次会话）和缓存未命中（每次匹配最多两条）。批量上传时，地点缓存的写入可能逼近每天 1000 次，超出后缓存写入失败，被忽略，匹配仍然可用，只是不再缓存。
- 所有内容都可以丢：丢了会话需要重新登录，丢了缓存会重新请求外部服务。

# 维护

线上命名空间用 `--remote`，不加则操作本地模拟：

```bash
# 列出会话
npx wrangler kv key list --binding KV --remote --prefix sess:
# 让某个会话失效
npx wrangler kv key delete "sess:<token>" --binding KV --remote
```

缓存到期自动清除，一般不需要手动处理。

# 相关

- 会话与限流的设计理由：[决策：认证](/architecture/decisions/0004-auth.md)。
- 缓存的设计理由：[决策：地点数据源](/architecture/decisions/0003-poi-providers.md)。
- 资源清单：[Cloudflare 资源](/architecture/cloudflare.md)。
