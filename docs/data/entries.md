---
type: D1 Table
title: entries
description: 记录：一件事、一个想法、一次练习或一项创作，有发生时间、Markdown 正文、类型、状态和公开范围；可以只有文字。
tags: [data, d1, entries]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
  - resource: https://github.com/ticoAg/Living/blob/main/shared/entries.ts
    title: 类型名、摘要与标签文字
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `en_<ulid>` |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 作者 |
| `type` | TEXT | 非空，默认 `'note'` | `note` 随记、`article` 文章、`reading` 阅读、`practice` 练习、`creation` 创作、`trip` 旅行；不设 CHECK，见 [规则](#规则) |
| `title` | TEXT | 可空 | 标题，最多 200 字 |
| `body` | TEXT | 可空 | 正文，Markdown 原文，最多 5 万字 |
| `occurred_at` | TEXT | 非空 | 发生时间，本地时间：`YYYY-MM-DD`（只知道日期）或 `YYYY-MM-DDTHH:mm:ss` |
| `visibility` | TEXT | 非空，默认 `'private'`，取值 `public` `unlisted` `private` | 公开范围 |
| `status` | TEXT | 非空，默认 `'published'`，取值 `draft` `published` `archived` | 状态，见 [可见性](#可见性) |
| `revision` | INTEGER | 非空，默认 `1` | 版本号，每次修改加一；编辑器凭它发现别处保存过的修改 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 写下它的时间 |
| `updated_at` | TEXT | 非空，默认当前 UTC 时间 | 最近一次修改，包括照片和标签的改动，以及其中照片被删除 |

索引：

- `entries_owner_occurred`（`owner_id`, `occurred_at`）：作者自己的时间线（`?mine=1`）和个人主页。
- `entries_public_occurred`（`occurred_at`），部分索引，只含 `visibility = 'public' AND status = 'published'`：不限作者的公开列表。

# 关系

- 作者 [users](/data/users.md)，删除用户时记录级联删除。
- 照片在 [entry_media](/data/entry-media.md)，标签在 [entry_tags](/data/entry-tags.md)；删除记录时这两处的行级联删除，照片和标签本身不受影响。
- 功能说明：[记录](/product/features/entries.md)、[今天](/product/features/today.md)、[档案](/product/features/archive.md)；在内容模型里的位置见 [内容模型](/product/content-model.md)。接口：[记录接口](/api/entries.md)。

# 可见性

`status` 与 `visibility` 相互独立：公开范围是作者的意图，状态决定这个意图是否生效。

| | `draft` | `published` | `archived` |
|---|---|---|---|
| 作者 | 全部可见 | 全部可见 | 全部可见 |
| 他人，`public` | 404 | 列表与详情 | 404 |
| 他人，`unlisted` | 404 | 只凭链接 | 404 |
| 他人，`private` | 404 | 404 | 404 |

SQL 条件在 `worker/lib/visibility.ts` 的 `entryList`（列表与计数）和 `entryById`（详情）。

记录的公开范围不改变其中照片的公开范围：他人只看到自己有权打开的照片，其余的从 `photoIds` 和 `media` 中略去，见 [entry_media](/data/entry-media.md#可见性)。

# 规则

- 新记录默认 `private`；接口创建的默认 `published`，编辑器新建的是 `draft`（第一次保存时）。
- 记录不能是空的：标题、正文、照片至少有一样，创建和修改都检查。
- `occurred_at` 和照片的 `taken_at` 一样不带时区。只有日期的值按字符串排序时排在当天有时刻的值之后，时间线因此把它放在当天最后。
- `type` 的取值会增加，表上不设 CHECK，Worker 按 `shared/types.ts` 的 `ENTRY_TYPES` 校验；读到不认识的值时界面按「随记」显示。
- 正文按写下的样子存 Markdown，只去掉开头的空行和末尾的空白，换行统一为 `\n`；第一行自己的缩进（例如全角空格）保留。
- 列表只读正文的前 301 个码点（`substr`），在 Worker 里截成不超过 300 个码点的摘要。
