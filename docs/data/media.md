---
type: R2 Bucket
title: R2 媒体文件
description: 存储桶 living-photos：o/ 前缀放原图（仅本人可读），v/ 前缀放三种尺寸图（按照片可见性读取），全部经 Worker 访问。
tags: [data, r2, media]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
---
# 存储桶

| 项 | 值 |
|---|---|
| 名称 | `living-photos` |
| 绑定 | `MEDIA`，只有 Worker 能读写 |
| 公开访问 | 保持关闭：不启用 `r2.dev` 公开开发地址，不绑定自定义域名 |

R2 存储桶默认私有。启用公开访问会绕过 Worker 里的权限判断，私密照片的文件也会被直接读到，所以不要启用。

# 对象键

| 键 | 内容 | 谁能读 |
|---|---|---|
| `o/<ownerId>/<photoId>.<ext>` | 原图，原样保存（含 EXIF），`<ext>` 随原文件类型 | 只有所有者，经 `/media/o/<ownerId>/<photoId>.<ext>` |
| `v/<photoId>/<s\|m\|l>.<webp\|jpg>` | 尺寸图 | 按照片可见性，经 `/media/v/<photoId>/<file>` |

[photos](/data/photos.md) 的 `file_key` 存原图的键，`variants` 存三个尺寸图的键和像素尺寸。D1 里的键就是 R2 的键，访问路径是 `/media/` 加上键。

# 尺寸图

| 档 | 长边（像素） |
|---|---|
| `s` | 480 |
| `m` | 1600 |
| `l` | 2560 |

- 由浏览器生成：旋正、缩放，重新编码为 WebP，浏览器不支持时用 JPEG。重新编码的图片不带 EXIF，位置和相机序列号等元数据不会随尺寸图公开。见 [决策：浏览器端处理图片](/architecture/decisions/0002-client-side-images.md)。
- 原图保留全部 EXIF，只有所有者能下载。
- 前端的响应式图片组件按显示宽度从三档里选用，见 [前端分区](/architecture/frontend.md)。
- 一张照片共 4 个对象：1 个原图加 3 个尺寸图。

# 访问规则

详细的响应头见 [媒体接口](/api/media.md)。

| 照片可见性 | `/media/v/…` | `/media/o/…` |
|---|---|---|
| `public`、`unlisted` | 任何人可读；`Cache-Control: public, max-age=31536000, immutable`，写入 Cache API，带 `ETag`，支持 304 | 只有所有者 |
| `private` | 只有所有者；`private, no-store` | 只有所有者 |

照片改为私密或被删除时，Worker 会清除当前数据中心里的缓存副本；Cache API 只作用于本数据中心，其他数据中心的副本要等到过期。需要彻底失效时，删除照片后重新上传。

# 生命周期

- 上传：`POST /api/photos` 先并行写入四个对象，再用 D1 batch 写数据库。任一对象写入失败，已写入的对象会被删除，返回 502 且不写 D1；D1 写入失败时同样删除刚写入的对象。
- 删除：`DELETE /api/photos/:id` 先在一个 D1 batch 里删除数据库行（并置空封面和头像引用），再删除四个对象。第二步失败只会留下无法访问的孤儿文件；可以按 `v/<photoId>/` 前缀对照 `photos.id` 清理。
- 修改标题、标签、可见性等只改 D1，不动 R2。
- 对象内容不可变：键里含 `photoId`，不会被覆盖，所以尺寸图可以缓存一年。

# 容量

R2 免费额度是 10 GB 存储，无出站流量费，见 [Cloudflare 资源](/architecture/cloudflare.md)。按一张手机照片原图 3–8 MB、三种尺寸共 1–2 MB 估算，10 GB 大约容纳一两千张。照片多了以后，R2 存储是主要成本。

# 本地开发

开发服务器（`npm run dev`）用本机模拟的 R2，数据在 `.wrangler/state/`，与线上互不影响，见 [本地开发](/runbooks/local-dev.md)。
