# 决策记录

* [0001 单个 Worker 承载静态资源、API 与媒体](0001-single-worker.md) - 前端、Hono API 和媒体放在同一个 Worker 里，只有 /api 和 /media 先进入 Worker
* [0002 浏览器端处理图片](0002-client-side-images.md) - 解码、缩放、ThumbHash、主色和 SHA-256 都在浏览器完成，不使用付费图像服务
* [0003 地点数据源与匹配](0003-poi-providers.md) - 站内地点优先，高德或 OpenStreetMap 兜底，按距离和镜头朝向打分，外部结果缓存在 D1
* [0004 用户名密码认证与邀请制](0004-auth.md) - PBKDF2 密码、KV 会话、邀请制注册和站长引导邀请码
* [0005 文档采用 OKF 并随仓库维护](0005-okf-docs.md) - 文档写成 Open Knowledge Format 知识包，与代码同评审
* [0006 工具链采用 Vite+，开发服务器内运行 Worker](0006-vite-plus.md) - Vite+ 统一开发、检查、测试和构建，Cloudflare Vite 插件让一个开发进程跑起完整站点
