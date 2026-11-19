---
type: API
title: 媒体接口
description: /media 路径下读取 R2 中的尺寸图、原图和附件：照片按自己的可见性，附件按所在记录的权限控制访问和缓存。
tags: [api, media]
---
# GET /media/v/:photoId/:file

`file` 为 `s.webp`、`m.webp`、`l.webp`（或 `.jpg`）。

- 照片为 `public` 或 `unlisted`：任何人可读。响应 `Cache-Control: public, max-age=31536000, immutable`，并写入 Cache API（键为完整 URL），后续请求直接从边缘缓存返回。
- `private`：所有者（会话）可读；持有能到达这张照片的 [分享链接](/api/shares.md#能看到什么) 的浏览器也可读。`Cache-Control: private, no-store`；其他人 404。
- 带 `ETag`，支持 `If-None-Match` 返回 304。

# GET /media/o/:ownerId/:file

原图，只有所有者可读，`Cache-Control: private, no-store`，`Content-Disposition: inline`。

# GET /media/a/:id、/media/a/:id/poster

附件的文件和视频的画面：按所在记录的权限读取，文件支持 `Range`，不进任何缓存；能播放的视频和声音、PDF 在页面里打开，其余只能下载。见 [附件接口](/api/attachments.md#文件)。

# 说明

照片改为私密后，已在边缘缓存的尺寸图最长仍可被访问到缓存过期；需要立即失效时删除照片重新上传。
