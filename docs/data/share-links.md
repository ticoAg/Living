---
type: D1 Table
title: share_links
description: 分享链接：作者为自己的一条记录、一个合集或一个项目生成的私密地址，可删除，可带有效期；打开它的人能看到这一项和其中显示的内容。
tags: [data, d1, sharing, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0008_shares_places.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `sl_<ulid>` |
| `token` | TEXT | 非空，唯一 | 地址 `/s/<token>` 里的密钥：18 个随机字节的 base64url，24 个字符 |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 作者 |
| `entry_id` | TEXT | 外键 → `entries.id`，删除时级联删除 | 分享的记录 |
| `theme_id` | TEXT | 外键 → `themes.id`，删除时级联删除 | 分享的合集 |
| `project_id` | TEXT | 外键 → `projects.id`，删除时级联删除 | 分享的项目 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 新建时间 |
| `expires_at` | TEXT | 可空 | 过期时间（UTC）；null 表示不过期 |

约束：`entry_id`、`theme_id`、`project_id` 恰好一个非空。

索引：

- `share_links_owner`（`owner_id`, `created_at`）：作者的全部链接，按新建时间。
- `share_links_entry`、`share_links_theme`、`share_links_project`（各自的列，只含非空行）：一项的链接，和删除时清理。

# 关系

- 属于 [users](/data/users.md)；指向 [entries](/data/entries.md)、[themes](/data/themes.md) 或 [projects](/data/projects.md) 之一。
- 用户、记录、合集或项目删除时，它的链接一并删除。接口在删除记录、合集和项目时也显式删除这里的行，不依赖外键开关。

# 规则

- 只能为自己的内容新建；`owner_id` 总是这一项的作者。
- 链接有效 = 行还在，且 `expires_at` 为 null 或晚于现在。删除就是删行，没有「停用」状态；过期的行留着，作者可以删。
- 打开链接的浏览器把 `token` 记在 Cookie `living_shares` 里；读取接口每次请求都回到这张表核对，所以删除和过期立刻生效。Cookie 本身不授予任何东西。
- 链接能到达什么、读取时怎么判断，见 [分享链接接口](/api/shares.md#能看到什么)。
- 一项最多 20 个，一个作者最多 500 个。
- 功能说明：[分享链接](/product/features/sharing.md)。
