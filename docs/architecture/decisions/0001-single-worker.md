---
type: Decision
title: 单个 Worker 承载静态资源、API 与媒体
description: 前端静态资源、Hono API 和媒体读取放在同一个 Worker 里，只有 /api 和 /media 先进入 Worker。
tags: [decision, architecture, cloudflare]
status: stable
decided: 2026-11-08
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 背景

Living 有三类流量：单页应用的页面与脚本、JSON 接口、受权限控制的图片。规模是个人到小圈子，目标是在免费额度内运行、一次部署、没有跨域问题。

Workers 的 Static Assets 可以直接托管构建产物，同时运行 Worker 代码，不需要再拆成静态站点加另一个 API 服务。

# 决定

只部署一个 Worker `living`：

- 入口 `worker/index.ts`，用 Hono 路由；绑定 D1 `DB`、R2 `MEDIA`、KV `KV` 和静态资源 `ASSETS`。
- 静态资源取自 `./dist`，`not_found_handling` 为 `single-page-application`：找不到文件的页面请求回退到 `index.html`，由前端路由处理。`html_handling` 为 `none`：路径只按文件名精确匹配，否则 `/index` 会被当成 `index.html` 重定向到 `/`。
- `run_worker_first` 只列出 `/api/*` 和 `/media/*`：这两类路径总是先进入 Worker，其余请求直接由静态资源响应。
- 站点只有一个源 `https://living.ticoag.fun`，Worker 绑定为自定义域名，关闭 `workers.dev` 和预览地址。

为什么必须写 `run_worker_first`：在单页应用模式下，浏览器的页面跳转请求（带 `Sec-Fetch-Mode: navigate`）如果没有匹配到静态文件，会直接得到 `index.html`，不经过 Worker。不列出这两个前缀，在地址栏打开 `/api/…`，或在新标签页打开 `/media/…` 的图片、下载原图，拿到的都会是前端页面。

# 后果

- 同源：Cookie 不需要 CORS 配置，写请求只需校验 `Origin`，见 [接口约定](/api/conventions.md)。
- 一份 `wrangler.jsonc`、一条构建发布流水线，见 [构建与发布](/architecture/ci-cd.md)。前端与接口属于同一个 Worker 版本，回滚时一起回退，见 [部署](/runbooks/deploy.md)。
- 静态资源请求免费且不限量，不占 Worker 调用次数。
- 每次 `/api` 和 `/media` 请求都会调用一次 Worker，Cache API 命中也一样；免费版每天 10 万次。超出后这两类路径返回 429，页面本身仍能打开，但没有数据和图片。图片响应带一年的 `immutable` 缓存，同一浏览器重复访问不会再请求。
- 页面是纯客户端渲染，分享链接没有按页面生成的预览（Open Graph）。
- 前端路由不能占用以 `/api/`、`/media/` 开头的路径。

# 备选

- **Pages 加 Functions**：同样同源，但版本、回滚、日志等能力以 Workers 为准，新项目直接用 Workers 更省事。
- **两个 Worker（静态站点和 API 分开）**：要处理跨域 Cookie 和 CORS，两套部署还会出现前后端版本不一致。
- **服务端渲染框架**：能解决分享预览，但构建和运行时更重；图库、地图主要是客户端交互，收益有限。
- **公开尺寸图走 R2 自定义域名**：省 Worker 调用，由 CDN 直出；但私密照片的尺寸图无法按可见性鉴权，改成私密后也无法立即失效，放弃。流量变大时可以只让确定公开的图片走自定义域名。
