---
type: D1 Table
title: themes
description: 主题：一次旅程或一个专题的标题、导语、封面、日期范围和公开范围。
tags: [data, d1, themes]
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
| `kind` | TEXT | 非空，默认 `'trip'`，取值 `trip` `topic` | 旅程（有日期、有路线）或专题（精选） |
| `title` | TEXT | 非空 | 标题 |
| `subtitle` | TEXT | 可空 | 副标题 |
| `intro` | TEXT | 可空 | 导语，纯文本段落 |
| `cover_photo_id` | TEXT | 可空，外键 → `photos.id`，删除时置空 | 封面照片；为空时接口取第一张照片 |
| `start_date` | TEXT | 可空 | 起始日期 `YYYY-MM-DD`，旅程用 |
| `end_date` | TEXT | 可空 | 结束日期 `YYYY-MM-DD` |
| `visibility` | TEXT | 非空，默认 `'private'`，取值 `public` `unlisted` `private` | 公开范围 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |
| `updated_at` | TEXT | 非空，默认当前 UTC 时间 | 最近修改时间，每次修改主题或条目时由 Worker 更新 |
| `published_at` | TEXT | 可空 | 首次设为 `public` 的时间 |

索引：

- `themes_owner`（`owner_id`, `updated_at`）：个人主页和 `?mine=1` 按更新时间列出。

# 关系

- 所有者 [users](/data/users.md)，删除用户时主题级联删除。
- 封面 [photos](/data/photos.md)，照片删除时 `cover_photo_id` 置空。
- 内容在 [theme_items](/data/theme-items.md)，删除主题时条目级联删除，照片不受影响。
- 功能说明：[主题](/product/features/themes.md)、[游记](/product/features/travelogue.md)。接口：[主题接口](/api/themes.md)。

# 可见性与隐私

主题的 `visibility` 与照片的相同三档，但默认是 `private`（照片默认 `public`）。

| 值 | 效果 |
|---|---|
| `public` | 出现在 `/themes` 和作者个人主页 |
| `unlisted` | 只能通过 `/t/<id>` 链接访问，不进入任何列表 |
| `private` | 只有作者；他人按 404 处理 |

主题的可见性不改变其中照片的可见性：公开主题里的私密照片，访客看不到（接口把它置为 `null`，游记跳过）；位置被隐藏的照片不出现在路线上。
