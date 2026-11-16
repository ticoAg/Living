---
type: Data Model
title: 数据模型总览
description: 数据分布在 D1、R2、KV 三处；本页给出表间外键、取值约定和删除时的级联规则。
tags: [data, d1, r2, kv]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0005_entries.sql
    title: 记录的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0006_projects.sql
    title: 项目的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# 分工

| 存储 | 放什么 | 文档 |
|---|---|---|
| D1 `living` | 用户、邀请码、标签、地点、照片、主题、记录、项目、隐私区域、设置，以及地点数据源的应答缓存 | 本目录下的十七张表 |
| R2 `living-photos` | 原图与三种尺寸图 | [R2 媒体文件](/data/media.md) |
| KV `living-kv` | 会话、登录限流 | [KV](/data/kv.md) |

D1 只存需要查询的元数据和地点缓存，R2 只存文件。KV 免费版每天只有 1000 次写入，只留给会话和登录限流；会频繁写入的地点缓存放在 D1 的 [place_cache](/data/place-cache.md)。KV 和缓存表里的内容都可以丢：丢了会话需要重新登录，丢了缓存会重新请求外部服务。

# 外键

D1 强制外键。表之间一共 23 条外键：

| 从 | 到 | 删除上级时 |
|---|---|---|
| `invites.created_by` | `users.id` | 置空 |
| `invites.used_by` | `users.id` | 置空 |
| `tags.owner_id` | `users.id` | 级联删除 |
| `tags.parent_id` | `tags.id` | 级联删除 |
| `pois.created_by` | `users.id` | 置空 |
| `photos.owner_id` | `users.id` | 级联删除 |
| `photos.poi_id` | `pois.id` | 置空 |
| `photo_tags.photo_id` | `photos.id` | 级联删除 |
| `photo_tags.tag_id` | `tags.id` | 级联删除 |
| `themes.owner_id` | `users.id` | 级联删除 |
| `themes.cover_photo_id` | `photos.id` | 置空 |
| `theme_items.theme_id` | `themes.id` | 级联删除 |
| `theme_items.photo_id` | `photos.id` | 级联删除 |
| `privacy_zones.owner_id` | `users.id` | 级联删除 |
| `entries.owner_id` | `users.id` | 级联删除 |
| `entry_media.entry_id` | `entries.id` | 级联删除 |
| `entry_media.photo_id` | `photos.id` | 级联删除 |
| `entry_tags.entry_id` | `entries.id` | 级联删除 |
| `entry_tags.tag_id` | `tags.id` | 级联删除 |
| `projects.owner_id` | `users.id` | 级联删除 |
| `entry_projects.entry_id` | `entries.id` | 级联删除 |
| `entry_projects.project_id` | `projects.id` | 级联删除 |
| `milestones.project_id` | `projects.id` | 级联删除 |

`users.avatar_photo_id` 指向 `photos.id`，但迁移里没有为它声明外键，删除照片时要由 Worker 手动置空（`DELETE /api/photos/:id` 已经这样做）。

# 约定

| 项 | 约定 |
|---|---|
| ID | 带前缀的 ULID：`u_` 用户、`ph_` 照片、`poi_` 地点、`th_` 主题、`it_` 主题条目、`en_` 记录、`pj_` 项目、`ms_` 里程碑、`t_` 用户标签、`pz_` 隐私区域。预置标签用可读的英文 id（如 `lake`，见 [预置标签](/data/preset-tags.md)）；邀请码和设置项分别以 `code`、`key` 为主键 |
| 时间 | 除 `photos.taken_at` 和 `place_cache.expires_at`（Unix 秒）外都是 UTC 的 ISO 8601 文本 `YYYY-MM-DDTHH:MM:SSZ`，默认值由 SQLite 的 `strftime` 生成。`taken_at` 是不带时区的本地时间 `YYYY-MM-DDTHH:mm:ss`，时区另存 `tz`；记录的 `occurred_at` 同样是本地时间，可以只有日期 `YYYY-MM-DD`。主题和项目的 `start_date`、`end_date`、主题条目的 `day`、里程碑的 `date` 是 `YYYY-MM-DD` |
| 布尔 | `INTEGER` 的 `0` / `1`（`in_living`、`favorite`） |
| 枚举 | `TEXT` 加 `CHECK`，取值写在各表的 Schema 里，与 `shared/types.ts` 的联合类型一致。`entries.type`、`projects.type` 例外：取值会增加，只由 Worker 校验 |
| JSON | `photos.variants`、`photos.palette` 存 JSON 文本，由 Worker 序列化 |
| 命名 | 列名 snake_case，接口 camelCase，由 Worker 转换，见 [接口约定](/api/conventions.md) |
| 坐标 | WGS-84，单位度。高德的 GCJ-02 只在调用外部接口时临时转换，见 [决策：地点数据源](/architecture/decisions/0003-poi-providers.md) |
| 校验 | 长度、格式、重名等规则由 Worker 检查；表上只有类型、非空、唯一、枚举和外键 |

# 删除时的级联

接口里没有删除用户的入口，下表描述直接操作数据库时的行为，以及删除照片时 Worker 要补做的事。

| 删除 | 一并删除 | 置空 | Worker 另外要做 |
|---|---|---|---|
| 用户 | 其照片、主题、记录、项目、用户标签、隐私区域，以及随之的 `photo_tags`、`theme_items`、`entry_media`、`entry_tags`、`entry_projects`、`milestones` | 邀请码的 `created_by` `used_by`、地点的 `created_by` | 清理 R2 里该用户的文件和 KV 里的会话 |
| 照片 | `photo_tags`、`theme_items`、`entry_media` 中引用它的行 | `themes.cover_photo_id` | 把 `users.avatar_photo_id` 置空；引用它的记录 `revision` 加一；删除 R2 里的原图和三种尺寸图 |
| 标签 | 全部子孙标签，及对应的 `photo_tags`、`entry_tags` | — | — |
| 主题 | 它的 `theme_items` | — | — |
| 记录 | 它的 `entry_media`、`entry_tags`、`entry_projects`；照片、标签和项目本身不动 | — | — |
| 项目 | 它的 `entry_projects`、`milestones`；记录本身不动 | — | — |
| 地点 | — | `photos.poi_id` | — |

# 各表

| 表 | 内容 |
|---|---|
| [users](/data/users.md) | 账号 |
| [invites](/data/invites.md) | 邀请码 |
| [tags](/data/tags.md) | 标签树 |
| [pois](/data/pois.md) | 地点 |
| [photos](/data/photos.md) | 照片 |
| [photo_tags](/data/photo-tags.md) | 照片与标签 |
| [themes](/data/themes.md) | 主题 |
| [theme_items](/data/theme-items.md) | 主题条目 |
| [entries](/data/entries.md) | 记录 |
| [entry_media](/data/entry-media.md) | 记录与照片 |
| [entry_tags](/data/entry-tags.md) | 记录与标签 |
| [projects](/data/projects.md) | 项目 |
| [entry_projects](/data/entry-projects.md) | 记录与项目 |
| [milestones](/data/milestones.md) | 里程碑 |
| [privacy_zones](/data/privacy-zones.md) | 隐私区域 |
| [settings](/data/settings.md) | 站点设置 |
| [place_cache](/data/place-cache.md) | 地点数据源的应答缓存 |

接下来的表（合集）和旧主题的兼容方式见 [数据演进](/data/evolution.md)。
