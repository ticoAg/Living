---
type: API
title: 导出接口
description: 读出登录者自己的整个档案：概要（各部分的数目、原文件的大小）和按页读取的十五个部分，浏览器据此拼出 Markdown、living.json、照片原文件和附件。也是导出文件的格式说明。
tags: [api, export, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/export.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/src/export/archive.ts
    title: 导出的文件
  - resource: https://github.com/ticoAg/Living/blob/main/src/export/run.ts
    title: 导出的过程
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [导出](/product/features/export.md)。导出在浏览器里拼装：Worker 只按页读出行、逐张返回原文件，所以档案再大，每次请求的 CPU 时间也在免费版的限制之内。

# 接口

都需要登录，未登录返回 401；只读出登录者自己的行，响应带 `Cache-Control: no-store`。不读出任何秘密：没有密码哈希、会话和分享链接的 token。

## `GET /api/export`

导出前的概要。

```json
{
  "profile": { "id": "u_…", "handle": "ada", "displayName": "Ada", "bio": null, "avatarPhotoId": null, "role": "owner", "photoVisibility": "private", "createdAt": "2026-01-01T00:00:00Z" },
  "counts": { "photos": 3402, "photoTags": 5120, "entries": 128, "entryMedia": 310, "entryTags": 96, "entryProjects": 40, "attachments": 6, "projects": 3, "milestones": 9, "themes": 4, "themeItems": 260, "tags": 61, "places": 85, "privacyZones": 1, "shareLinks": 2 },
  "originalBytes": 13312000000,
  "attachmentBytes": 734003200
}
```

`counts` 是每一部分的行数，`originalBytes` 是全部照片原文件的字节数，`attachmentBytes` 是记录里全部附件的字节数。

## `GET /api/export/:part?after=`

一部分的一页：`{ "rows": [...], "next": "…" }`。一页最多 500 行，或者大约 1 MB 的文字（长文章多时早些截止），先到为准；`next` 不为 `null` 时，带 `after=<next>` 读下一页，直到 `next` 为 `null`。

| part | 一行 | 哪些行 | 顺序，也是 `after` 的格式 |
|---|---|---|---|
| `photos` | `ExportPhoto` | 自己的照片 | `id` |
| `photoTags` | `{ photoId, tagId, source }` | 自己的照片上的标签 | `photoId,tagId` |
| `entries` | `ExportEntry` | 自己的记录，包括草稿和已归档的 | `id` |
| `entryMedia` | `{ entryId, photoId, position, caption }` | 自己的记录里的照片 | `entryId,photoId` |
| `entryTags` | `{ entryId, tagId }` | 自己的记录上的标签 | `entryId,tagId` |
| `entryProjects` | `{ entryId, projectId }` | 自己的记录所属的项目 | `entryId,projectId` |
| `attachments` | `ExportAttachment` | 自己的记录里的附件；没传完的、不在记录里的不算 | `id` |
| `projects` | `ExportProject` | 自己的项目 | `id` |
| `milestones` | `ExportMilestone` | 自己的项目的里程碑 | `id` |
| `themes` | `ExportTheme` | 自己的合集 | `id` |
| `themeItems` | `ExportThemeItem` | 自己的合集的条目 | `id` |
| `tags` | `ExportTag` | 预置标签（`ownerId` 为 `null`）和自己的标签 | `id` |
| `places` | `ExportPlace` | 自己的照片或记录用到的地点，以及自己建的（`own`） | `id` |
| `privacyZones` | `ExportPrivacyZone` | 自己的隐私区域 | `id` |
| `shareLinks` | `ExportShareLink` | 自己的分享链接：打开的是什么（`kind`、`itemId`）、何时建、何时过期，不含 token | `id` |

- 没有这一部分返回 404；`after` 的段数或格式不对返回 400「after 不是这一部分的位置」。
- 字段与 [数据](/data/) 里对应表的列一一对应，改为 camelCase，见下文 [living.json](#livingjson)。
- 照片的原文件从 `GET /media/<fileKey>` 读，只有本人能读；原文件不在时，导出改读大图 `GET /media/<variants.l.key>`，见 [媒体接口](/api/media.md)。
- 附件的文件从 `GET /media/a/<id>` 读，视频的封面（`poster` 为 `true`）从 `GET /media/a/<id>/poster`，见 [附件接口](/api/attachments.md#文件)。

## 用量

- D1：一页先读最多 501 个键和它们的大小，再读这一页的行，一共约是行数的两倍；概要把每一部分数一遍。
- Workers：概要 1 次、每部分每页 1 次，每张照片的原文件 1 次（原文件不在时再读一次大图，并核对一次登录状态），每个附件 1 次，有封面的视频再 1 次。免费版每天 10 万次请求，见 [费用](/architecture/cloudflare.md#费用)。

# 导出的文件

浏览器把读到的行写成一个文件夹 `living-<用户名>/`。下载 zip 时，每个 zip 都以这个文件夹为根，可以解压到同一个位置合起来；living.json 和 Markdown 在最后一个 zip 里。

| 路径 | 内容 |
|---|---|
| `README.md` | 这次导出里有什么 |
| `entries/<年>/<日期> <标题>.md` | 一条记录；没有标题时用正文开头，再没有就用类型名 |
| `projects/<名称>.md` | 一个项目：说明、里程碑、项目里的记录 |
| `collections/<标题>.md` | 一个合集，条目按原来的顺序 |
| `media/<年>/<拍摄日期>_<照片 id>.<扩展名>` | 照片的原文件（或代替它的大图），扩展名取自文件本身 |
| `media/undated/<照片 id>.<扩展名>` | 没有拍摄时间的照片 |
| `media/<年>/<记录的日期>_<附件 id>.<扩展名>` | 附件的文件，按记录的发生日期；扩展名取自文件名，没有时按类型，再没有为 `bin` |
| `media/<年>/<记录的日期>_<附件 id>.poster.<webp\|jpg>` | 视频的封面 |
| `living.json` | 全部信息 |

- 文件名里，各个系统不允许的字符（`< > : " / \ | ? *`）、Markdown 链接会出错的 `# [ ]` 和控制字符换成空格，最长 40 个字，不以点或空格结尾，`CON` 这类 Windows 的保留名后面加 `_`。重名（不分大小写）时加「 (2)」「 (3)」。
- 图片和链接都是相对路径，写在尖括号里（`![说明](<../../media/2026/2026-11-16_ph_….jpg>)`），路径里可以有空格。图片的替代文字是说明的第一行，完整的说明在图片下面；导出里没有这张照片的文件时，写成「（照片 ph_…）」。
- 附件排在照片后面，是指向文件的链接，文字是上传时的文件名（`[湖边.mp4](<../../media/2026/2026-11-16_at_….mp4>)`），说明在下面；导出里没有它的文件时，写成「（附件 湖边.mp4）」。

## Markdown 的 frontmatter

值都是 JSON（YAML 能直接读），空的不写。

| 文件 | 字段 |
|---|---|
| 记录 | `id`、`type`、`title`、`occurred`（发生时间）、`created`、`updated`、`status`、`visibility`、`place`（地点名，加区县或城市）、`tags`（标签名）、`projects`（项目名）、`collections`（合集标题） |
| 项目 | `id`、`type`、`status`、`visibility`、`start`、`end`、`created`、`updated` |
| 合集 | `id`、`kind`、`visibility`、`start`、`end`、`created`、`updated`、`published` |

## living.json

```json
{
  "format": "living-export",
  "version": 2,
  "exportedAt": "2026-11-17T01:05:00.000Z",
  "site": { "name": "Living", "url": "https://living.example" },
  "profile": { "id": "u_…", "handle": "ada" },
  "photos": [{ "id": "ph_…", "takenAt": "2026-11-16T15:30:00", "fileKey": "o/u_…/ph_….jpg", "tags": [{ "id": "lake", "source": "manual" }], "file": "media/2026/2026-11-16_ph_….jpg" }],
  "entries": [{ "id": "en_…", "media": [{ "photoId": "ph_…", "caption": null }], "attachments": [{ "id": "at_…", "kind": "video", "name": "湖边.mp4", "mime": "video/mp4", "size": 52428800, "duration": 12.5, "width": 1920, "height": 1080, "poster": true, "caption": null, "createdAt": "…", "file": "media/2026/2026-11-16_at_….mp4", "posterFile": "media/2026/2026-11-16_at_….poster.webp" }], "tagIds": ["lake"], "projectIds": [], "file": "entries/2026/2026-11-16 西湖边的一个下午.md" }],
  "projects": [{ "id": "pj_…", "milestones": [{ "id": "ms_…", "title": "第一首曲子", "body": null, "date": "2026-10-01", "createdAt": "…", "updatedAt": "…" }], "file": "projects/学吉他.md" }],
  "collections": [{ "id": "th_…", "items": [{ "id": "it_…", "position": 0, "kind": "day", "photoId": null, "entryId": null, "text": "到杭州", "day": "2026-11-15" }], "file": "collections/杭州.md" }],
  "tags": [],
  "places": [],
  "privacyZones": [],
  "shareLinks": [],
  "files": ["README.md", "entries/2026/2026-11-16 西湖边的一个下午.md", "media/2026/2026-11-16_ph_….jpg"]
}
```

| 键 | 内容 |
|---|---|
| `format`、`version` | 固定为 `living-export` 和版本号，现在是 2。加字段不升版本；字段改了意思或去掉时升版本，旧版本的说明留在这里：第 1 版的记录没有 `attachments`，`media/` 里只有照片 |
| `exportedAt` | 导出的时间（UTC） |
| `site` | 站点的名字和地址 |
| `profile` | 账号：id、用户名、显示名、简介、头像照片、角色、新照片的默认公开范围、注册时间 |
| `photos` | [photos](/data/photos.md) 的列（不含 `owner_id`）：`variants`、`palette` 是对象和数组，`focus_x`、`focus_y` 合成 `focus: [x, y]`，`in_living`、`favorite` 是布尔值。加上 `tags`（[photo_tags](/data/photo-tags.md)：标签 id 和来源）、`file`（导出里的文件，没有时为 `null`），用大图代替原文件时 `fileIsLarge: true` |
| `entries` | [entries](/data/entries.md) 的列，按发生时间排。加上 `media`（[entry_media](/data/entry-media.md)，按顺序）、`attachments`（[attachments](/data/attachments.md) 的列，按顺序；`file` 是导出里的文件，`posterFile` 是视频的封面，没有时为 `null`）、`tagIds`、`projectIds` 和 `file` |
| `projects` | [projects](/data/projects.md) 的列，按开始日期排。加上 `milestones`（[milestones](/data/milestones.md)，按日期）和 `file` |
| `collections` | [themes](/data/themes.md) 的列。加上 `items`（[theme_items](/data/theme-items.md)，按顺序）和 `file` |
| `tags` | [tags](/data/tags.md)：预置标签（`ownerId` 为 `null`）和自己的标签，`parentId` 是上级 |
| `places` | [pois](/data/pois.md)：`own` 表示是这个账号建的；`aliases` 是数组，只有自己建的地点才有，别人建的为 `[]`（[地点接口](/api/pois.md) 也只把别名给能编辑的人） |
| `privacyZones` | [privacy_zones](/data/privacy-zones.md) |
| `shareLinks` | [share_links](/data/share-links.md)，不含 token：拿到导出的人打不开这些链接 |
| `files` | 这次导出的全部文件（不含 living.json 自己）。下次导出到同一个文件夹时，据此删掉不再有的文件 |

时间的写法与接口相同：拍摄时间 `takenAt` 和发生时间 `occurredAt` 是不带时区的本地时间，其余是 UTC，见 [接口约定](/api/conventions.md#格式)。zip 里文件的修改时间：记录是发生的时间，照片是拍摄的时间（没有时用上传的时间），附件和封面是所在记录发生的时间，项目和合集是最近修改的时间，README 和 living.json 是导出的时间。导出到文件夹时，修改时间就是写入的时间。
