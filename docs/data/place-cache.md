---
type: D1 Table
title: place_cache
description: 地点数据源的应答缓存：周边地点、名称搜索和逆地理的结果，按键存 JSON，带过期时间，每小时清理过期行；丢失无碍。
tags: [data, d1, places, cache]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0004_place_cache.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/worker/providers/cache.ts
    title: 缓存读写
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `key` | TEXT | 主键 | 缓存键，格式见下文 |
| `value` | TEXT | 非空 | 数据源的应答，JSON 文本 |
| `expires_at` | INTEGER | 非空 | 过期时间，Unix 秒 |

索引：

- `place_cache_expires`（`expires_at`）：每小时的定时任务按它删除过期行。

# 键

| 键 | 值 | 有效期 | 用途 |
|---|---|---|---|
| `poi:near:<source>:<lat4>:<lng4>:<radius>` | 外部地点候选列表 | 7 天 | 周边搜索 |
| `poi:q:<provider>:<q>[:<lat2>:<lng2>]` | 名称搜索的外部结果 | 1 天 | 名称搜索 |
| `geo:rev2:<provider>:<lat3>:<lng3>` | 省、城市与区县 `{"province","city","district"}` | 7 天 | 逆地理，地点匹配和每小时的省份补全共用 |

- `<provider>`：`amap` 或 `osm`。配置了 `AMAP_KEY` 且坐标在中国大陆范围内用 `amap`，其余用 `osm`。缓存按数据源分开，设置或删除 `AMAP_KEY` 后不会读到另一个数据源的结果。
- `<source>`：`amap` 或 `photon`。OpenStreetMap 的附近地点来自 Photon。
- `<lat4>` `<lng4>`：坐标四舍五入到 4 位小数，约 10 米网格；`<lat3>` `<lng3>` 取 3 位，约 100 米；`<lat2>` `<lng2>` 取 2 位，约 1 千米；`<radius>` 是搜索半径（米）；`<q>` 是 NFKC 规范化并转小写的搜索词。
- 键沿用了放在 KV 时的写法。

# 规则

- 读：`expires_at` 已过（不大于当前时间）的行算未命中，重新请求外部服务后覆盖写入。
- 写：外部请求失败时不写；成功的结果连同空列表都写入，同一位置不再重复请求。
- 缓存读写出错（数据库不可用、内容不是 JSON）都被忽略，地点匹配和搜索照常完成，只是不走缓存。
- 清理：每小时的定时任务删除过期行，见 [定时任务](/architecture/cloudflare.md#定时任务)。
- 整张表都可以清空：丢了缓存只会重新请求外部服务。

# 为什么不放 KV

原先这些缓存放在 [KV](/data/kv.md)。KV 免费版每天只有 1000 次写入，会话、登录限流和缓存共用；一次上传几百张地点分散的照片就能用完，之后会话写不进去，当天无法登录（UTC 0 点才重置）。D1 免费版每天 10 万行写入，缓存挪到这里后，KV 的写入只用于登录。

每写入一条缓存，连同主键和 `expires_at` 两个索引，D1 约记 3 行写入；清理时删除一行也按写入计。批量上传 500 张地点各不相同的照片约 1000 次缓存写入，即约 3000 行，远在每天 10 万行之内。

# 关系

- 独立的缓存表，不与其他表关联。
- 读写在 `worker/providers/cache.ts`，调用方是 `worker/providers/match.ts`（周边搜索、逆地理、名称搜索）和经逆地理间接使用它的 `worker/lib/regions.ts`。
- 接口：[地点接口](/api/pois.md)。设计理由：[决策：地点数据源](/architecture/decisions/0003-poi-providers.md)。
