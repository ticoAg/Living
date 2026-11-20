---
type: D1 Table
title: attachments
description: 附件：记录里的视频、录音和其他文件，按上传时的样子存在 R2；没有自己的公开范围，跟着所在的记录；不在记录里的每小时清理。
tags: [data, d1, r2, entries, attachments]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0010_attachments.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/attachments.ts
    title: 读写与清理
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `at_<ulid>`；导入的见 [导入接口](/api/import.md#规则) |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 作者 |
| `entry_id` | TEXT | 可空，外键 → `entries.id`，删除时置空 | 所在的记录；为空时不在任何记录里 |
| `position` | INTEGER | 非空，默认 0 | 在记录里的顺序，从 0 起 |
| `caption` | TEXT | 可空 | 在这条记录里的说明，最多 2000 字 |
| `kind` | TEXT | 非空，`video` / `audio` / `file` | 视频、声音（录音）、其他文件 |
| `name` | TEXT | 非空 | 上传时的文件名，下载时用，最多 200 字 |
| `mime` | TEXT | 非空 | 文件类型，不带参数 |
| `size` | INTEGER | 非空，大于 0 | 字节数，最多 2 GiB |
| `duration` | REAL | 可空 | 秒，浏览器读得出时才有 |
| `width`、`height` | INTEGER | 可空 | 视频的像素尺寸 |
| `file_key` | TEXT | 非空 | R2 里的文件 |
| `poster_key` | TEXT | 可空 | R2 里视频的画面 |
| `upload_id` | TEXT | 可空 | R2 分片上传的编号，传完后清空 |
| `created_at` | TEXT | 非空 | 加入的时间；导入的保留导出里的 |
| `uploaded_at` | TEXT | 可空 | 传完的时间；为空时还在传 |
| `loose_since` | TEXT | 可空 | 从什么时候起不在记录里：开始上传、传完或离开记录的时间；在记录里时为空 |

索引：

- `attachments_entry`（`entry_id`, `position`，只收在记录里的）：记录详情按顺序读出附件，列表为每条记录读出摘要。
- `attachments_owner`（`owner_id`, `id`）：导出按页读出；数一个人同时在传几个。
- `attachments_loose`（`loose_since`，只收不在记录里的）：每小时的清理。

# R2

| 对象键 | 内容 |
|---|---|
| `a/<owner_id>/<id>.<扩展名>` | 文件，按上传时的样子；视频和录音去掉了拍摄地点，见 [附件](/product/features/attachments.md#位置)。扩展名取自文件名，没有时为 `bin`；`Content-Type` 是 `mime` |
| `a/<owner_id>/<id>.poster.<webp\|jpg>` | 视频的一帧，浏览器截的，最多 2 MB |

文件分片上传（R2 multipart upload，每片 16 MiB），传完之前 R2 里没有这个对象。读取规则见 [附件接口](/api/attachments.md#文件)。

# 关系

- 一条记录可以有多个附件（最多 20 个），一个附件只在一条记录里。附件不像照片那样被几处引用，所以不经过 [entry_media](/data/entry-media.md)：行本身就带着 `entry_id`、`position` 和 `caption`。
- 没有 `visibility`：能打开记录的人就能读到它的附件，作者总能读到自己的，不在记录里的只有作者能读到。
- 删除记录时，Worker 在同一批语句里删掉它的附件，再删 R2 里的文件。外键的「置空」只在记录以别的方式消失时起作用，留下的附件由清理删掉。
- 删除用户时，行随 `owner_id` 级联删除，R2 里的文件要另外清理，见 [数据模型总览](/data/overview.md#删除时的级联)。

# 清理

每小时的定时任务（`purgeLooseAttachments`）一次最多删 200 个，先删行，再删文件、放弃没传完的分片上传：

| 附件 | 什么时候删 |
|---|---|
| 没传完 | 开始上传一天以后 |
| 传完了，没放进记录 | 传完七天以后 |
| 从记录里去掉 | 去掉七天以后 |

R2 自己也会在七天后丢弃没完成的分片上传。
