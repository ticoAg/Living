---
type: API
title: 媒体库接口
description: 登录者自己的附件（在哪条记录里，或者清理任务什么时候删去它）、各类文件有多少多大，以及自己的记录用到了哪些照片。
tags: [api, library, attachments, photos]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/library.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/attachments.ts
    title: 清理的天数
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [媒体库](/product/features/library.md)。照片本身是 [照片列表](/api/photos.md#get-apiphotos) 的 `mine=1`。

# `GET /api/library`

需要登录，未登录返回 401；只有登录者自己的。响应带 `Cache-Control: no-store`。→ `LibraryResponse`：

```json
{
  "attachments": [LibraryAttachment],
  "truncated": false,
  "usage": {
    "photos": { "count": 128, "bytes": 812345678 },
    "video": { "count": 3, "bytes": 420000000 },
    "audio": { "count": 12, "bytes": 9800000 },
    "file": { "count": 2, "bytes": 310000 }
  },
  "entryPhotoIds": ["ph_…"]
}
```

## `attachments`

自己的全部附件，包括没传完的，按开始上传的时间从新到旧，最多 `LIBRARY_ATTACHMENTS_LIMIT`（5000）个；更多时只列最新的，`truncated` 为 `true`（多查一行判断）。

`LibraryAttachment` 是 [附件](/api/attachments.md) 的 `OwnAttachment`（`state`、`entryId`）加上：

| 字段 | 内容 |
|---|---|
| `caption` | 所在记录里写在它下面的说明；不在记录里为 `null`（从记录里去掉时，说明跟着记录走） |
| `uploadedAt` | 文件传完的时间（UTC）；没传完为 `null` |
| `purgeAt` | 不在记录里时，每小时的清理在这之后第一次运行时删去它（UTC）：没传完的是开始后一天，不在记录里的是传完或者离开记录后七天，离开时间不明的（记录不经接口删掉时）从传完算起；在记录里为 `null` |
| `entry` | 所在的记录：`id`、`label`（标题，或正文第一行的纯文本，或类型名）、`occurredAt`、`visibility`、`status`；不在记录里为 `null` |

删除一个不在记录里的附件是 [`DELETE /api/attachments/:id`](/api/attachments.md#delete-apiattachmentsid)。

## `usage`

各类有多少、一共多少字节：`photos` 是照片的原文件（尺寸图不算在内）；`video`、`audio`、`file` 是传完了的附件，在不在记录里都算，没传完的不算。

## `entryPhotoIds`

自己的照片里，被自己的至少一条记录用到的，每张一次，不分记录的状态和公开范围。媒体库用它找出不在任何记录里的照片。
