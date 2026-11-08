---
type: API
title: 媒体接口
description: /media 路径下读取 R2 中的尺寸图与原图，按照片可见性控制访问和缓存。
tags: [api, media]
---
# GET /media/v/:photoId/:file

`file` 为 `s.webp`、`m.webp`、`l.webp`（或 `.jpg`）。

- 照片为 `public` 或 `unlisted`：任何人可读。响应 `Cache-Control: public, max-age=31536000, immutable`，并写入 Cache API（键为完整 URL），后续请求直接从边缘缓存返回。
- `private`：只有所有者（会话）可读，`Cache-Control: private, no-store`；其他人 404。
- 带 `ETag`，支持 `If-None-Match` 返回 304。

# GET /media/o/:ownerId/:file

原图，只有所有者可读，`Cache-Control: private, no-store`，`Content-Disposition: inline`。

# 说明

照片改为私密后，已在边缘缓存的尺寸图最长仍可被访问到缓存过期；需要立即失效时删除照片重新上传。
