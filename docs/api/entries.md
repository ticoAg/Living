---
type: API
title: 记录接口
description: 记录的列表、详情、创建、修改（带版本号防覆盖）与删除；默认仅自己可见，状态与公开范围共同决定他人能否看到；记录可以归入作者自己的项目。
tags: [api, entries]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/entries.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/entryInput.ts
    title: 输入校验
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# GET /api/entries

`{ "entries": EntrySummary[], "truncated": boolean }`，按 `occurredAt` 倒序；同一时间的按写入先后，后写的在前。只有日期的记录排在当天有时刻的记录之后。

| 参数 | 返回 |
|---|---|
| （无） | 所有用户 `public` 且 `published` 的记录 |
| `owner=<handle>` | 该用户对请求者可见的记录：他人看到公开且已完成的，本人看到全部；用户不存在时为空列表 |
| `mine=1` | 请求者自己的全部记录，含草稿和已归档（需登录） |
| `project=<id>` | 这个项目里请求者能打开的记录：他人看到已完成、公开或仅链接的，本人看到全部；请求者打不开这个项目时为空列表。持有这个项目的 [分享链接](/api/shares.md) 时，还有其中已完成的私密记录 |
| `poi=<id>` | 地点是它的记录：他人看到公开且已完成的，本人看到全部 |
| `type=<类型>` | 这些类型的记录：`note`、`article`、`reading`、`practice`、`creation`、`trip`，几个用逗号隔开（`type=article,creation`）；空着等于不筛选 |
| `from=YYYY-MM-DD` | 发生在这一天或以后的 |
| `to=YYYY-MM-DD` | 发生在这一天或以前的，含这一天的所有时刻；只有日期的记录算在那一天 |
| `located=1` | 地图能放上去的：有地点的，或者 `photoIds` 里有一张照片对请求者显示了位置（自己的坐标或地点，按 [位置精度](/api/conventions.md#位置精度对非所有者)，位置隐藏的不算）。`true` 也行，别的值等于不筛选。[地图的记录图层](/product/features/map.md#记录图层) 用它 |

参数可以同时给出，结果取交集；项目里的记录都是项目作者的，见 [项目接口](/api/projects.md#记录与项目)。

- 不分页：最多返回 `ENTRY_LIST_LIMIT`（5000）条，超出时略去最早的，`truncated` 为 true。[日历](/product/features/calendar.md) 用 `from`、`to` 一次只读一个月，所以多早的月份都完整。
- `from`、`to` 不是真实存在的日期时返回 400「from 的格式应为 YYYY-MM-DD」（`to` 同理），`to` 早于 `from` 时返回 400「to 不能早于 from」。`type` 里有别的词（包括大小写不同、多余的逗号和空格）时返回 400「type 只能是 note / article / reading / practice / creation / trip，可以用逗号隔开几个」。
- `excerpt` 是正文开头的 Markdown 原文，最多 300 个码点，能在换行处截断就在换行处截断；`hasMore` 表示正文还有后续。`chars` 是正文一共多少个码点（Markdown 原文，没有正文为 0），[文章](/product/features/showcase.md#文章) 列表用它显示字数。
- `photoIds` 只含请求者能打开的照片，按记录里的顺序；`attachments` 是附件的摘要（`id`、`kind`、`duration`、`poster`），按顺序，能看到记录的人都能看到；`tagIds` 为直接标签；`projectIds` 只含请求者能在列表里看到的项目（本人：全部），按项目创建的先后。
- `poi`：作者选的地点（`id`、`name`、`category`、`city`、`district`，和地图用的 `lat`、`lng`），没有为 null。能看到记录的人都能看到它的地点；地点落在作者的隐私区域里时，编辑器会提醒，不会自动隐藏。
- 缓存同 [接口约定](/api/conventions.md#缓存)。

# GET /api/entries/:id

`EntryDetail`：摘要的全部字段，加完整的 `body`、`media`（照片及其在这条记录里的说明）、`attachments`（附件及其说明，见 [附件接口](/api/attachments.md#在记录里)）、`revision` 和 `themes`。

- 他人只能打开 `published` 且 `public` 或 `unlisted` 的记录；其余（包括草稿、已归档）返回 404，与不存在无法区分。
- 持有能到达这条记录的 [分享链接](/api/shares.md)（这条记录的，或收录它的合集、项目的）时，已完成的私密记录也能打开，`media` 含全部照片。
- `media` 略去请求者不能打开的照片，不留空位；照片对象不带笔记 `note`。`attachments` 没有自己的公开范围，能打开记录就全部列出。
- `themes`：收录这条记录、请求者能在列表里看到的 [合集](/api/themes.md)（公开的，本人：全部），每个带 `id`、`title`，按合集的 `updatedAt` 倒序。仅链接可见的合集不从记录页透露，与照片页一样。

# POST /api/entries（登录）

`CreateEntryBody` → 201 `{ "entry": EntryDetail }`，id `en_<ulid>`。

| 字段 | 默认 | 规则 |
|---|---|---|
| `occurredAt` | 必填 | `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`，本地时间；也接受省略秒或带时区后缀的写法，时区后缀被丢弃。由浏览器给出，Worker 不知道作者的本地时间 |
| `type` | `note` | `ENTRY_TYPES` 之一 |
| `title` | null | 去掉首尾空白，最多 200 字 |
| `body` | null | Markdown，最多 5 万字；去掉开头的空行和末尾的空白，第一行的缩进保留；空白等于 null |
| `visibility` | `private` | |
| `status` | `published` | 编辑器第一次保存时传 `draft` |
| `media` | `[]` | `{ photoId, caption? }[]`，最多 200 张，说明最多 2000 字；必须都是自己的照片，否则 400；重复的照片只保留第一次 |
| `attachments` | `[]` | `{ attachmentId, caption? }[]`，最多 20 个，说明最多 2000 字；必须是自己传完的、不在别的记录里的附件，否则 400，见 [附件接口](/api/attachments.md#在记录里) |
| `tagIds` | `[]` | 最多 200 个；只保留预置标签和自己的标签，其他忽略 |
| `projectIds` | `[]` | 最多 50 个；只保留自己的项目，其他忽略 |
| `poiId` | null | 已有的 [地点](/api/pois.md) id，不存在时 400；搜索结果先用 `POST /api/pois` 建成地点 |

标题、正文、照片、附件至少有一样，否则 400。请求体最大 1 MB。上限定义在 `shared/limits.ts` 的 `ENTRY_LIMITS`。

# PATCH /api/entries/:id（本人）

`UpdateEntryBody` → `{ "entry": EntryDetail }`。

- 只改给出的字段；`title`、`body`、`poiId` 给 null 即清空；`media`、`attachments`、`tagIds`、`projectIds` 给出时整体替换；不再列出的附件离开记录，七天后删去。
- 任何改动都让 `revision` 加一并更新 `updatedAt`；什么都没给时原样返回。
- 带上 `revision`（编辑开始时的版本）：与当前版本不同时返回 409，什么都不改：

```json
{ "error": "conflict", "message": "这条记录在别的窗口或设备上改过了，先载入最新的内容", "revision": 7 }
```

- 改完之后仍不能为空，规则同创建。
- 他人的记录：能打开的返回 403，打不开的返回 404。

# DELETE /api/entries/:id（本人）

→ `{ "ok": true }`。记录与它的附件（连同 R2 里的文件）、照片关联、标签关联、项目关联、合集里的条目、分享链接一起删除，照片、标签、项目、合集和地点本身不受影响；收录过它的合集更新 `updatedAt`。

# 别处的变化

- `GET /api/photos/:id` 的 `entries`：引用这张照片、请求者能在列表里看到的记录（本人：全部），按发生时间倒序，`label` 为标题，或正文第一行的纯文本，或类型名。见 [照片](/api/photos.md)。
- `GET /api/tags` 的 `entryCount`、`GET /api/users/:handle` 的 `entryCount`：同样只数请求者能在列表里看到的记录。
- 删除照片会从引用它的记录里移除它，并让这些记录的 `revision` 加一；删除标签会移除记录上的这个标签；删除项目会让记录不再属于它，`revision` 不变。
- 项目的统计、封面和照片来自其中的记录，见 [项目接口](/api/projects.md)。
- 合集可以收录记录，统计、封面和地点也算上记录里的照片，见 [合集接口](/api/themes.md)。

数据见 [entries](/data/entries.md)、[entry_media](/data/entry-media.md)、[attachments](/data/attachments.md)、[entry_tags](/data/entry-tags.md)、[entry_projects](/data/entry-projects.md)。
