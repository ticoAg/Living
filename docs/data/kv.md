---
type: KV Namespace
title: KV 会话与限流
description: 命名空间 living-kv：登录会话和登录限流计数，都带过期时间；地点与逆地理缓存已移到 D1，KV 每天 1000 次的写入只留给登录。
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

- `<token>`：32 字节随机数的 base64url，与 Cookie `living_session` 的值相同。退出登录时删除该键。
- `rl:login`：固定窗口计数，`resetAt` 是窗口结束的 Unix 秒。同一 IP 对同一用户名每分钟最多 5 次，超过返回 429；登录成功后删除该键。`<handle>` 统一转小写，因为用户名不区分大小写。60 秒是 KV 允许的最短过期时间。
- 键的约定来自 [认证接口](/api/auth.md) 和 [接口约定](/api/conventions.md)。
- 地点与逆地理缓存（`poi:*`、`geo:*`）原先也在这里，现在在 D1 的 [place_cache](/data/place-cache.md)，键的写法不变。线上 KV 里留下的旧缓存键不再读写，也不用手动清理，最长 7 天后自行过期。

# 一致性与配额

- KV 最终一致：写入在本数据中心立即可见，其他地方最长约 60 秒后可见。退出登录后，别处的节点最长约 60 秒内仍可能读到旧会话；并发登录时限流计数可能略小于真实次数，对挡住暴力猜测足够。
- 免费版每天 10 万次读、1000 次写（不同键）、1000 次删除，UTC 0 点重置，超出后该类操作报错。同一个键每秒最多写一次。
- 读主要来自带会话的接口请求（每次读一次 `sess:`）；写只来自登录和注册：每次登录尝试写一条限流计数，登录或注册成功再写一条会话（登录成功还删除限流计数，退出登录删除会话，都算删除额度）。每天约 500 次成功登录才会用完写入额度，个人站点够用。
- 写入额度用完后，`startSession` 写会话失败，登录和注册返回 500，直到 UTC 0 点。所以不要再往 KV 里放会频繁写入的东西：地点缓存因此移到了 D1。
- 所有内容都可以丢：丢了会话需要重新登录。

# 维护

线上命名空间用 `--remote`，不加则操作本地模拟：

```bash
# 列出会话
npx wrangler kv key list --binding KV --remote --prefix sess:
# 让某个会话失效
npx wrangler kv key delete "sess:<token>" --binding KV --remote
```

限流计数和会话到期自动清除，一般不需要手动处理。

# 相关

- 会话与限流的设计理由：[决策：认证](/architecture/decisions/0004-auth.md)。
- 地点与逆地理缓存：[place_cache](/data/place-cache.md)。
- 资源清单：[Cloudflare 资源](/architecture/cloudflare.md)。
