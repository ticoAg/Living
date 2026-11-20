---
type: API
title: 附件接口
description: 视频、录音和其他文件：分片上传、视频的画面、删除没放进记录的上传，以及 /media/a 下按所在记录的权限读取文件。
tags: [api, attachments, media, entries]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/attachments.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/attachments.ts
    title: 校验、分片与清理
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/media.ts
    title: 读取文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/attachments.ts
    title: 文件按什么类型提供
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [附件](/product/features/attachments.md)，数据见 [attachments](/data/attachments.md)。

附件是作者的一个文件，属于一条记录：先上传，再随记录的保存放进记录（[记录接口](/api/entries.md) 的 `attachments`）。附件没有自己的公开范围，能打开记录的人就能播放、下载里面的附件。

# 上传

1. `POST /api/attachments`：说明要传的文件，得到 id 和分几片。
2. `PUT /api/attachments/:id/parts/:n`：一片一片送上文件。
3. `POST /api/attachments/:id/complete`：交上每一片的回执，文件拼好。
4. 视频再 `PUT /api/attachments/:id/poster`：浏览器截下的一帧。
5. 保存记录时，在 `attachments` 里列出它。

都需要登录，只能操作自己的附件；别人的附件按不存在处理（404）。

## `POST /api/attachments`

`CreateAttachmentBody` → 201 `AttachmentUpload`。

```json
{ "kind": "video", "name": "湖边.mp4", "mime": "video/mp4", "size": 52428800, "duration": 12.5, "width": 1920, "height": 1080 }
```

```json
{ "attachment": { "id": "at_…", "kind": "video", "name": "湖边.mp4", "poster": false, "state": "uploading", "entryId": null, "…": "…" }, "partBytes": 16777216, "parts": 4 }
```

| 字段 | 规则 |
|---|---|
| `kind` | `video`、`audio`（录音和其他声音）或 `file` |
| `name` | 文件名，下载时用。去掉控制字符和改变文字方向的字符（`…gpj.exe` 这类伪装），`/`、`\` 换成 `_`，最多 200 字 |
| `mime` | `类型/子类型`，去掉参数（`audio/webm;codecs=opus` 存为 `audio/webm`），空白按 `application/octet-stream`；视频要 `video/…`，录音要 `audio/…` |
| `size` | 字节数，至少 1，最多 2 GiB，超过返回 413 |
| `duration` | 秒，可空；`file` 不带 |
| `width`、`height` | 像素，可空；只有视频带 |

- 浏览器读不出时长和尺寸时不给，照样能传。
- 同时在传的附件（一小时内开始、还没传完的）最多 10 个，再开始返回 429 `rate_limited`。
- 上限定义在 `shared/limits.ts` 的 `ATTACHMENT_LIMITS` 和 `ATTACHMENT_PART_BYTES`。

## `PUT /api/attachments/:id/parts/:n`

请求体是第 `n` 片（从 1 起）的字节，`Content-Type: application/octet-stream`。每片 `partBytes`（16 MiB），最后一片是剩下的。→ `AttachmentPart`：

```json
{ "partNumber": 1, "etag": "…" }
```

- 长度不对返回 400；`Content-Length` 超过 16 MiB 时返回 413，不读请求体。
- 已经传完的附件返回 409。
- 存储服务出错时返回 502；同一片可以重传。

分片的大小由两头决定：R2 的分片上传要求每片至少 5 MiB、除最后一片外一样大，Workers 的请求体最多 100 MB。

## `POST /api/attachments/:id/complete`

`CompleteAttachmentBody` → `AttachmentResponse`，`state` 为 `loose`。

```json
{ "parts": [{ "partNumber": 1, "etag": "…" }, { "partNumber": 2, "etag": "…" }] }
```

- 每一片都要有、只能有一次，顺序不限；缺片或回执不对返回 400。
- 拼好的文件和 `size` 不一样时，附件连同文件删去，返回 400「传上来的文件和说好的大小不一样，请重新上传」。
- 已经完成的附件再请求一次，原样返回：上一次的应答丢在路上时，浏览器可以放心重试。

## `PUT /api/attachments/:id/poster`

视频的一帧，在视频放起来之前显示。请求体是 WebP 或 JPEG（`Content-Type` 为 `image/webp` 或 `image/jpeg`，开头的字节也要对得上），最多 2 MB。→ `AttachmentResponse`，`poster` 为 `true`。再送一次就换掉。不是视频返回 400。

## `DELETE /api/attachments/:id`

删掉一个不在记录里的附件和它的文件 → `{ "ok": true }`。在记录里的返回 409：先在记录里去掉它。没传完的也能删，R2 里传了一半的分片一起丢弃。

## 状态

`OwnAttachment` 的 `state`：

| `state` | 是什么 | 谁能读到文件 |
|---|---|---|
| `uploading` | 还在传 | 没有人 |
| `loose` | 传完了，不在任何记录里；或者从记录里去掉了 | 作者 |
| `attached` | 在一条记录里（`entryId`） | 能打开这条记录的人 |

不在记录里的附件由每小时的清理删掉：没传完的一天以后，传完了却没放进记录、或者从记录里去掉的七天以后，见 [attachments](/data/attachments.md#清理)。

# 在记录里

`POST /api/entries`、`PATCH /api/entries/:id` 的 `attachments`：`{ attachmentId, caption? }[]`，按顺序，最多 20 个，说明最多 2000 字；重复的只算第一次。

- 只能放自己的、传完了的附件。新记录只能放不在记录里的；修改时也可以是这条记录本来就有的。不然返回 400：「只能添加你自己上传的附件」「附件还没有传完」「这个附件在另一条记录里」。
- `PATCH` 给出时整体替换：不再列出的附件离开记录，七天后删去。
- 有附件的记录可以没有标题、正文和照片。
- 删除记录时，附件和文件一起删去。
- 记录详情的 `attachments` 是 `EntryAttachment[]`（附件加上 `caption`）；列表的摘要带 `AttachmentBrief[]`（`id`、`kind`、`duration`、`poster`），够画一张卡片。

# 文件

## `GET /media/a/:id`

附件的文件。

- **谁能读**：作者；能按 id 打开这条记录的人（已完成、公开或仅链接，见 [接口约定](/api/conventions.md#可见性)）；持有能到达这条记录的 [分享链接](/api/shares.md#能看到什么) 的浏览器。不在记录里的、没传完的只有作者能读。其余返回 404。
- **分段**：支持一段 `Range`，返回 206 和 `Content-Range`；超出文件的返回 416。带 `ETag`。
- **缓存**：`Cache-Control: private, no-store`。记录的公开范围随时会改，文件只留在播放它的地方，不进边缘缓存。
- **类型**（`shared/attachments.ts` 的 `servedAs`）：

| 文件 | `Content-Type` | `Content-Disposition` |
|---|---|---|
| 浏览器能放的视频和声音：`video/mp4`、`video/quicktime`、`video/webm`、`audio/mpeg`、`audio/mp4`、`audio/webm`、`audio/ogg`、`audio/wav`、`audio/flac` 等 | 原来的类型 | `inline` |
| PDF | `application/pdf` | `inline`，浏览器用自己的阅读器打开 |
| 其余：HTML、SVG、文档、压缩包…… | `application/octet-stream` | `attachment`，只能下载 |

- `?download`：一律 `attachment`，给下载按钮用。文件名按 RFC 6266 给出：ASCII 的 `filename` 和 UTF-8 的 `filename*`。
- **安全**：PDF 以外都带 `Content-Security-Policy: default-src 'none'; sandbox`；全都带 `Cross-Origin-Resource-Policy: same-origin` 和 `X-Content-Type-Options: nosniff`。上传的东西不会在这个站点上运行，别的站点也嵌入不了。
- 凭分享链接读到时带 `Vary: Cookie`。

## `GET /media/a/:id/poster`

视频的画面，谁能读同上，没有画面返回 404。记录公开且已完成时 `Cache-Control: private, max-age=3600`，其余 `private, no-store`。

# 用量

- Workers：每 16 MiB 一次请求，1 GB 的视频约 64 次，再加开始、完成和画面三次。免费版每天 10 万次。
- R2：每一片一次 A 类操作；文件和画面占存储，与照片共用免费的 10 GB。
- 播放：每次开始播放或拖动进度条是一次 `Range` 请求，经 Worker 读 R2（B 类操作）。
- 详见 [费用](/architecture/cloudflare.md#费用)。
