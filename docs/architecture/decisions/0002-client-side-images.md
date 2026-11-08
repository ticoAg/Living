---
type: Decision
title: 浏览器端处理图片
description: 解码、缩放、ThumbHash、主色和 SHA-256 都在浏览器完成，Worker 只校验并存储，不使用付费图像服务。
tags: [decision, architecture, media]
status: stable
decided: 2026-11-08
---
# 背景

每张照片需要：读取 EXIF、按方向旋正、三种尺寸（长边 480 / 1600 / 2560）、ThumbHash 占位、5 个主色、用于去重的 SHA-256。原图最大 50 MB，一次批量上传可能有几百张。

这些是像素运算，Worker 不适合做：免费版每次调用只有 10 ms CPU 时间和 128 MB 内存；Cloudflare 的图像服务（Images、图像变换）按存储或变换次数计费。目标是不依赖付费服务。

# 决定

所有图像运算在浏览器里完成，Worker 只做校验、写 R2 和 D1：

1. 浏览器逐张处理：`exifr` 读 EXIF；按方向旋正（HEIC 浏览器解不开时由 `libheif-js` 解码，见下）；缩放并重新编码为 WebP（不支持时用 JPEG）；`thumbhash` 生成占位；提取主色；`crypto.subtle` 计算 SHA-256。重新编码的图片本身不含 EXIF。（早先还用 `suncalc` 算太阳高度来建议光线和季节标签，标签建议去掉后不再需要。）
2. 一张照片一次 `multipart/form-data` 请求：`meta`（JSON）、`original`、`s`、`m`、`l`，见 [照片接口](/api/photos.md)。
3. 原图原样存入 R2，只有所有者能读；公开展示只用生成的三种尺寸，见 [R2 媒体文件](/data/media.md)。

HEIC 与其他限制：

- HEIC 先交给浏览器解码（Safari 可以）。浏览器解不开时，用 `libheif-js` 解码：它是 libheif 的 WebAssembly 构建，在 Web Worker 里运行，解出的像素接着走同一条管线。解码器只在选了这类文件时才加载，主包和上传页的代码都不含它。Worker（服务端）依然没有解码能力，也不需要：它只校验、存原图和浏览器生成的尺寸图，查看者也只读尺寸图。详见 [上传与整理](/product/features/upload.md#heic-与-heif)。
- 选型是 `libheif-js` 1.23.5（LGPL-3.0）。它是 libheif 本体的 WebAssembly 构建，版本号跟着 libheif 走（这一版内含 libheif 1.23.5），一直在发布，上游的安全修复跟得上。在 Chromium 里用同一批照片对比：解码 12 MP 约 0.7–1 秒，和 `@discourse/heic`（同为 libheif，体积更小，但只有一个 1.0.0 版本）相当；`heic-to` 也基于 libheif，但发布的是 asm.js，不是 WebAssembly，要慢 2.5–3 倍、体积更大。
- LGPL-3.0：库保持未修改，放在独立的 Worker 文件里，依赖写在 `package.json`，随时可以换版本。要不要在站点上附带许可证声明，由站点所有者决定。
- 解码前先检查容器是否完整：libheif 对被截断的 HEIC 不报错，只会补灰，发布出去就是一张缺了一块的照片。超过 1 亿像素的 HEIC 直接拒绝，因为解码时每个像素约占 20 字节，内存不够会让标签页崩溃，未发布的队列随之丢失。每种失败都给出中文提示，只影响那一张。
- 支持的输入是 JPEG、PNG、WebP、AVIF、HEIC/HEIF；RAW、TIFF 等不在支持范围内。
- 单张原图不超过 50 MB。像素特别大的图片受浏览器画布大小限制，可能解码或缩放失败，标为失败后可以重试。

# 后果

- 不需要付费图像服务，也不受 Worker CPU 和内存限制；上传时 Worker 只做校验和写存储。
- 一张照片一个请求：Worker 限制原图不超过 50 MB、每张尺寸图不超过 12 MB、整个请求不超过 88 MB，在 Cloudflare 免费和 Pro 套餐的 100 MB 请求体上限之内。Worker 要在内存里接收这些数据，所以不把多张照片打包进一个请求。
- 处理速度取决于用户设备：手机处理几百张大图较慢、耗电，所以逐张处理并显示队列状态，见 [上传与整理](/product/features/upload.md)。
- 第一次解码 HEIC 要多下载约 0.7 MB（压缩后）；之后在同一批里不再加载，空闲 15 秒后释放 WebAssembly 的内存。
- 服务端信任客户端：Worker 无法验证尺寸图确由原图生成，也无法保证尺寸图不含 EXIF，`sha256` 同样由客户端提供。风险限于上传者自己的账号。若以后向不受信任的上传者开放，需要在 Worker 里增加检查。
- 画质由浏览器的编码器决定，不同浏览器生成的尺寸图略有差异。
- 路线图里的 Workers AI 识别可以直接读 `m` 尺寸图，不需要改这条管线，见 [路线图](/product/roadmap.md)。

# 备选

- **Cloudflare Images**：存储加变体的托管方案，省事，但按量计费，原图还要交给另一套存储和权限模型。
- **图像变换（`cf.image` 或 `/cdn-cgi/image`）**：按需变换，按唯一变换次数计费，免费额度很小；私密照片的授权仍要自己处理。
- **Worker 里用 WASM 图像库**：免费版 10 ms CPU 和 128 MB 内存装不下一张几千万像素照片的解码与缩放；付费版也要为 CPU 时间付费。
- **另起容器或服务器做处理**：多一套运维面，违背 [单个 Worker](/architecture/decisions/0001-single-worker.md) 的决定。
- **上传后异步处理（Queues 加 Worker）**：CPU 与内存限制不变，反而增加状态和失败重试。
