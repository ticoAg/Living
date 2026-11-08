---
type: Feature
title: 上传与整理
description: 批量选择或拖入照片，浏览器读取 EXIF、生成三种尺寸和占位图，匹配地点、建议标签，确认后发布。iPhone 的 HEIC 在所有浏览器里都能上传。
tags: [record, mvp]
route: "/upload, /studio/photo/:id"
area: studio
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/src/studio/process.ts
    title: 浏览器端处理管线
  - resource: https://github.com/ticoAg/Living/blob/main/src/studio/heic.ts
    title: HEIC 后备解码（WebAssembly，在 Worker 里运行）
  - resource: https://github.com/ticoAg/Living/blob/main/src/studio/heif.ts
    title: 识别 HEIC、检查完整性、读取色彩空间
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/photoInput.ts
    title: 上传校验
---
# 流程

1. 拖入或选择多张照片（JPEG、PNG、WebP、AVIF、HEIC；单张不超过 50 MB）。iPhone 默认拍出的 HEIC 在所有浏览器里都能上传，见 [HEIC 与 HEIF](#heic-与-heif)。
2. 浏览器端逐张处理：读取 EXIF（时间、时区、GPS、海拔、朝向、相机、镜头、焦距、光圈、快门、ISO）；按方向旋正；生成长边 480 / 1600 / 2560 的 WebP（不支持时用 JPEG）；生成 ThumbHash；提取 5 个主色；计算 SHA-256 用于去重。生成的图不含 EXIF。
3. 有 GPS 的照片请求 [地点匹配](/product/features/poi-matching.md)，自动选中第一名；拿不准时标记"待确认"。
4. 没有 GPS 的照片，按拍摄时间找同批里前后 2 小时内最近的一张有地点的照片，给出"按时间推断"；也可以搜索地点或新建自定义地点。
5. 每张照片可填标题、[笔记](/product/features/photo-notes.md)、[标签](/product/features/hierarchical-tags.md)（含自动建议）、公开范围、位置精度、是否进入 Living、加入哪些 [主题](/product/features/themes.md)。
6. 发布：上传原图和三种尺寸到 R2，写入 D1。可逐张发布，也可"发布全部已匹配"。

# HEIC 与 HEIF

iPhone 默认拍出 HEIC。Safari 能直接解码它，Chrome、Edge、Firefox 不能，所以上传页带了一个后备解码器：

- **何时启用**：浏览器自己解不开、而文件是 HEIC/HEIF（按扩展名、MIME 类型，或没有这两者时按文件头里的品牌判断）。这时用 [libheif](https://github.com/strukturag/libheif) 的 WebAssembly 构建（npm 包 `libheif-js`）解码成像素，之后和其他格式走同一条管线：旋正、三种尺寸、ThumbHash、主色、SHA-256。选型理由见 [决策：浏览器端处理图片](/architecture/decisions/0002-client-side-images.md)。
- **只在需要时加载**：解码器压缩后约 0.7 MB，放在单独的 Worker 文件里，主包和上传页的代码都不含它；选 JPEG、PNG 等不会下载它。一批照片里只加载一次，最后一张解码完 15 秒后释放（WebAssembly 的内存不会自己缩小）。
- **不卡页面**：解码在后台线程（Web Worker）里进行，12 MP 的照片约 1 秒，页面照常响应。状态仍是"处理中"，队列里那一行写着"加载 HEIC 解码器…"或"解码 HEIC…"，右侧面板有对应的说明。
- **EXIF**：由 `exifr` 直接从 HEIC 文件读取，时间、时区、GPS、海拔、朝向、相机、镜头、曝光参数与 JPEG 一致。相机直出的 `.hif`（文件头品牌是 `heix`）`exifr` 不认，照片可以上传，但读不到时间和位置。
- **方向**：HEIC 把旋转写在文件容器里（`irot`、`imir`），libheif 解码时已经应用，得到的像素本身就是正的，不会旋转两次；照片尺寸记的是旋正后的宽高。
- **颜色**：iPhone 的 HEIC 带 Display P3 色彩描述文件，而解码器给出的是没有色彩管理的 RGB 值。上传页读取文件里的描述文件（只读 `meta` 区），把像素标成 `display-p3`，由浏览器转成 sRGB，结果和 P3 的 JPEG 一样饱满。没有描述文件的（多数安卓手机）、sRGB 的，不做转换。
- **原图原样保存**：HEIC 不转码，存成 `.heic` 或 `.heif`（取决于浏览器报告的类型），只有所有者能读，见 [R2 媒体文件](/data/media.md)。查看者只会拿到 WebP/JPEG 尺寸图，任何浏览器都不需要解码 HEIC。
- **失败只影响那一张**：队列里其他照片照常处理，这一张标为"失败"，面板里用中文说明原因，可以重试。会失败的情形有：解码器加载失败（离线或被拦截）、文件被截断或已损坏（libheif 对残缺的文件不报错，只会补灰，所以解码前先检查文件结构是否完整）、像素超过 1 亿（解码时每个像素约占 20 字节，内存不够会让整个标签页崩溃，未发布的队列随之丢失）、内存不足、解码超过 3 分钟。

# 队列状态

已匹配 / 待确认 / 无位置 / 位置不公开（在隐私区域内）/ 已发布 / 失败（可重试）。处理中的照片显示"处理中"。

# 规则

- 单张原图上限 50 MB；同一用户重复上传同一文件（SHA-256 相同）时提示已存在并跳过。
- 原图原样保存（HEIC 也是），只有本人能下载；公开展示只用生成的尺寸。
- 上传中途关闭页面，未发布的照片不会入库。

# 编辑

`/studio/photo/:id` 可以修改标题、笔记、标签、地点、公开范围、位置精度、是否进入 Living、收藏，或删除照片（同时删除 R2 中的所有文件）。
