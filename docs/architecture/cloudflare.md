---
type: Infrastructure
title: Cloudflare 资源
description: Living 在 Cloudflare 账号 6f12e69d… 下使用的 Worker、D1、R2、KV、自定义域名与构建配置。
tags: [architecture, cloudflare]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
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
| 域名 | `living.ticoag.fun`（Worker 自定义域名，DNS 自动托管） | 区域 `c823bc358d7a051de8df8cb19c6d2736` | — |
| Git 连接 | GitHub `ticoAg/Living` | 连接 `698a6c91-dcf8-461c-a196-797ace8fc0c9` | — |

`workers.dev` 与预览地址关闭，只通过自定义域名访问。可观测性（Workers Logs）开启。

# 变量与密钥

| 名称 | 类型 | 用途 |
|---|---|---|
| `SITE_NAME` | 变量 | 站点名，默认 Living |
| `SITE_URL` | 变量 | `https://living.ticoag.fun` |
| `AMAP_KEY` | 密钥（可选） | 高德 Web 服务 Key；未设置时地点匹配使用 OpenStreetMap |

配置方法见 [密钥与初始化](/runbooks/secrets.md)。

# 费用

全部在免费额度内可运行：Workers 免费版每天 10 万次请求；D1 5 GB；R2 10 GB 存储且无出站流量费；KV 每天 10 万次读。照片多了以后主要成本是 R2 存储。
