---
type: D1 Table
title: themes
description: 合集（表名沿用 themes）：一次旅程或一个专题的标题、导语、封面、日期范围和公开范围。
tags: [data, d1, themes, collections]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `th_<ulid>` |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 所有者 |
| `kind` | TEXT | 非空，默认 `'trip'`，取值 `trip` `topic` | 旅程（有日期、有路线，读作游记）或专题（精选） |
| `title` | TEXT | 非空 | 标题 |
| `subtitle` | TEXT | 可空 | 副标题 |
| `intro` | TEXT | 可空 | 导语，纯文本段落 |
| `cover_photo_id` | TEXT | 可空，外键 → `photos.id`，删除时置空 | 封面照片；为空时接口按条目顺序取第一张照片，记录条目里的照片也算 |
| `start_date` | TEXT | 可空 | 起始日期 `YYYY-MM-DD`，旅程用 |
| `end_date` | TEXT | 可空 | 结束日期 `YYYY-MM-DD` |
| `visibility` | TEXT | 非空，默认 `'private'`，取值 `public` `unlisted` `private` | 公开范围 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |
| `updated_at` | TEXT | 非空，默认当前 UTC 时间 | 最近修改时间：修改合集或条目时，以及其中的照片、记录被删除时，由 Worker 更新 |
| `published_at` | TEXT | 可空 | 首次设为 `public` 的时间 |

索引：

- `themes_owner`（`owner_id`, `updated_at`）：个人主页和 `?mine=1` 按更新时间列出。

产品里叫合集；表、接口和代码沿用 themes 的名字，`/t/:id` 的地址不变，见 [数据演进](/data/evolution.md#合集)。

# 关系

- 所有者 [users](/data/users.md)，删除用户时合集级联删除。
- 封面 [photos](/data/photos.md)，照片删除时 `cover_photo_id` 置空。
- 内容在 [theme_items](/data/theme-items.md)：照片、文字段落、日期分段和 [记录](/data/entries.md)。删除合集时条目级联删除，照片和记录不受影响。
- 功能说明：[合集](/product/features/themes.md)、[游记](/product/features/travelogue.md)。接口：[合集接口](/api/themes.md)。

# 可见性与隐私

合集的 `visibility` 与照片、记录相同三档，默认是 `private`。

| 值 | 效果 |
|---|---|
| `public` | 出现在 `/themes` 和作者个人主页 |
| `unlisted` | 只能通过 `/t/<id>` 链接访问，不进入任何列表 |
| `private` | 只有作者；他人按 404 处理 |

合集的可见性不改变其中内容的可见性：公开合集里的私密照片、仅自己可见或还没完成的记录，读者看不到（接口把它们置为 `null`，阅读页跳过），也不计入照片数、记录数和封面；位置被隐藏的照片不出现在路线和地点里。
