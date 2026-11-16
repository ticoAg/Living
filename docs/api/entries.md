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
| `project=<id>` | 这个项目里请求者能打开的记录：他人看到已完成、公开或仅链接的，本人看到全部；请求者打不开这个项目时为空列表 |

参数可以同时给出，结果取交集；项目里的记录都是项目作者的，见 [项目接口](/api/projects.md#记录与项目)。

- 不分页：最多返回 `ENTRY_LIST_LIMIT`（5000）条，超出时略去最早的，`truncated` 为 true。
- `excerpt` 是正文开头的 Markdown 原文，最多 300 个码点，能在换行处截断就在换行处截断；`hasMore` 表示正文还有后续。
- `photoIds` 只含请求者能打开的照片，按记录里的顺序；`tagIds` 为直接标签；`projectIds` 只含请求者能在列表里看到的项目（本人：全部），按项目创建的先后。
- 缓存同 [接口约定](/api/conventions.md#缓存)。

# GET /api/entries/:id

`EntryDetail`：摘要的全部字段，加完整的 `body`、`media`（照片及其在这条记录里的说明）、`revision` 和 `themes`。

- 他人只能打开 `published` 且 `public` 或 `unlisted` 的记录；其余（包括草稿、已归档）返回 404，与不存在无法区分。
- `media` 略去请求者不能打开的照片，不留空位；照片对象不带笔记 `note`。
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
| `tagIds` | `[]` | 最多 200 个；只保留预置标签和自己的标签，其他忽略 |
| `projectIds` | `[]` | 最多 50 个；只保留自己的项目，其他忽略 |

标题、正文、照片至少有一样，否则 400。请求体最大 1 MB。上限定义在 `shared/limits.ts` 的 `ENTRY_LIMITS`。

# PATCH /api/entries/:id（本人）

`UpdateEntryBody` → `{ "entry": EntryDetail }`。

- 只改给出的字段；`title`、`body` 给 null 即清空；`media`、`tagIds`、`projectIds` 给出时整体替换。
- 任何改动都让 `revision` 加一并更新 `updatedAt`；什么都没给时原样返回。
- 带上 `revision`（编辑开始时的版本）：与当前版本不同时返回 409，什么都不改：

```json
{ "error": "conflict", "message": "这条记录在别的窗口或设备上改过了，先载入最新的内容", "revision": 7 }
```

- 改完之后仍不能为空，规则同创建。
- 他人的记录：能打开的返回 403，打不开的返回 404。

# DELETE /api/entries/:id（本人）

→ `{ "ok": true }`。记录与它的照片关联、标签关联、项目关联、合集里的条目一起删除，照片、标签、项目和合集本身不受影响；收录过它的合集更新 `updatedAt`。

# 别处的变化

- `GET /api/photos/:id` 的 `entries`：引用这张照片、请求者能在列表里看到的记录（本人：全部），按发生时间倒序，`label` 为标题，或正文第一行的纯文本，或类型名。见 [照片](/api/photos.md)。
- `GET /api/tags` 的 `entryCount`、`GET /api/users/:handle` 的 `entryCount`：同样只数请求者能在列表里看到的记录。
- 删除照片会从引用它的记录里移除它，并让这些记录的 `revision` 加一；删除标签会移除记录上的这个标签；删除项目会让记录不再属于它，`revision` 不变。
- 项目的统计、封面和照片来自其中的记录，见 [项目接口](/api/projects.md)。
- 合集可以收录记录，统计、封面和地点也算上记录里的照片，见 [合集接口](/api/themes.md)。

数据见 [entries](/data/entries.md)、[entry_media](/data/entry-media.md)、[entry_tags](/data/entry-tags.md)、[entry_projects](/data/entry-projects.md)。
