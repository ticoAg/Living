---
type: API
title: 搜索接口
description: 在登录者自己的档案里按字搜索：记录、照片、项目、合集、地点和标签分组返回，每组带总数和含有这些字的片段。只搜自己的内容，不建全文索引。
tags: [api, search, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/search.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/shared/search.ts
    title: 拆词与片段
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [搜索](/product/features/search.md)。

# `GET /api/search?q=&in=`

需要登录，未登录返回 401。只搜登录者自己的内容，不管公开范围：草稿和已归档的记录、仅自己可见的照片都在内；别人的内容一概不搜。响应带 `Cache-Control: no-store`。

| 参数 | 说明 |
|---|---|
| `q` | 要找的字。按空白拆成词，引号（`"…"`、`“…”`、`「…」`）里的算一个词，还没有收尾的引号算到最后（边打字边搜），词内的连续空白合成一个空格；英文大小写不同的同一个词只算一次。最多 5 个词、100 个字 |
| `in` | 可选，只搜一组：`entries`、`photos`、`projects`、`themes`、`places`、`tags` |

- 不带 `in`：六组都搜，每组最多返回 `SEARCH_HITS` 个（记录 50、照片 60、其余 20）。
- 带 `in`：只搜这一组，最多返回 500 个（`SEARCH_GROUP_MAX`），响应里只有这一组。
- 错误：`q` 为空或只有空白返回 400「输入要找的字」，太长返回「最多 100 个字」，词太多返回「最多 5 个词」；`in` 不是上面的值返回 400。

```json
{
  "terms": ["西湖"],
  "entries": { "total": 12, "hits": [{ "id": "en_…", "type": "note", "title": "西湖边的一个下午", "label": "西湖边的一个下午", "occurredAt": "2026-11-16T15:30:00", "status": "published", "visibility": "private", "photo": { "id": "ph_…" }, "snippet": "…下午去了西湖，湖边的柳树…" }] },
  "photos": { "total": 3, "hits": [] },
  "projects": { "total": 0, "hits": [] },
  "themes": { "total": 1, "hits": [] },
  "places": { "total": 1, "hits": [] },
  "tags": { "total": 0, "hits": [] }
}
```

`total` 是这一组一共有多少个符合的，不受返回个数的限制。

# 怎么匹配

- 每个词都要出现，可以出现在不同的字段里（标题里一个、正文里另一个也算）。
- 一个词出现在字段的任何位置都算（SQLite `LIKE '%词%'`）：中文没有空格可以分词，两个字（西湖、书法）就是一个完整的词。`%`、`_` 和 `\` 按字面匹配；英文字母不分大小写，其他文字按原样。
- 正文、说明和笔记按 Markdown 原文找，链接的网址也算；地点的别名一个一个找。
- 不建 FTS5 全文索引：D1 导出数据库时不支持虚拟表，带虚拟表的导出（`--compatibility sqlite3_cli_only`）又不能导回 D1，而这份导出是 [备份](/runbooks/backup.md) 的一部分。

| 组 | 在哪些字段里找 | 排序 |
|---|---|---|
| `entries` | 标题、正文、照片说明（[entry_media](/data/entry-media.md) 的 `caption`） | 标题含有任一个词的在前，然后按发生时间从近到远 |
| `photos` | 标题、笔记；只看有标题或笔记的照片 | 标题含有任一个词的在前，然后按拍摄时间从近到远 |
| `projects` | 名称、说明、里程碑的标题和内容 | 名称含有任一个词的在前，然后按最近修改 |
| `themes` | 标题、副标题、前言、条目的文字（[theme_items](/data/theme-items.md) 的 `text`） | 标题含有任一个词的在前，然后按最近修改 |
| `places` | 名称、别名；只列出自己的照片或记录在那里的地点，以及自己建的 | 自己在那里的照片和记录多的在前 |
| `tags` | 名称；预置标签只在自己的照片或记录用过时列出，自己的标签都列出 | 自己用过的次数多的在前 |

# 每组的结果

- `entries`：`SearchEntryHit`。`label` 是标题，没有标题时是正文的第一行（纯文本），再没有就是类型名；`photo` 是第一张照片；`snippet` 取正文里第一个找到的词附近，正文里没有就取第一个含有词的照片说明，都没有就是正文开头。
- `photos`：照片列表的字段（`PhotoSummary`），加上取自笔记的 `snippet`。
- `projects`：`SearchProjectHit`，`snippet` 取说明里第一个找到的词附近，说明里没有就取第一个含有词的里程碑（按日期，标题和内容），都没有就是说明开头。
- `themes`：`SearchThemeHit`，带封面 `cover`，与合集列表相同：选定的封面，没有时是第一张照片（记录里的也算）；`snippet` 取前言里第一个找到的词附近，前言里没有就取第一个含有词的条目文字（按条目顺序），都没有就是前言开头。
- `places`：`SearchPlaceHit`，`photoCount`、`entryCount` 只算自己的。
- `tags`：`SearchTagHit`，带上级标签的名字 `parentName`；计数只算自己的。

`snippet` 是去掉 Markdown 的纯文本，最多 90 个字，从第一个找到的词前面 24 个字起；前后有截断时加「…」。没有可显示的文字时为 `null`。

# 读取的行数

每组一条语句，几组放在一个 `db.batch` 里。D1 按读取的行数计费（免费版每天 500 万行）：一次搜索要读一遍自己的记录、项目、合集和它们的条目；照片只读有标题或笔记的，走部分索引 `photos_owner_text`（[photos](/data/photos.md#索引)）。几千条记录的档案搜一次读几千行。
