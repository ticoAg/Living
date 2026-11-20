---
type: D1 Table
title: users
description: 账号：用户名、显示名、角色、密码哈希，以及新照片的默认公开范围。
tags: [data, d1, account]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 建表的迁移
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0007_collections.sql
    title: 加入 photo_visibility 的迁移
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `u_<ulid>` |
| `handle` | TEXT | 非空，唯一，`COLLATE NOCASE` | 用户名，不区分大小写；格式 `^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$`，保留名见 [认证接口](/api/auth.md) |
| `display_name` | TEXT | 非空 | 显示名，1–40 字符 |
| `bio` | TEXT | 可空 | 简介 |
| `avatar_photo_id` | TEXT | 可空，无外键 | 头像：本人某张照片的 id |
| `role` | TEXT | 非空，默认 `'member'`，取值 `owner` `admin` `member` | 角色 |
| `password_hash` | TEXT | 非空 | `pbkdf2$<迭代次数>$<salt>$<hash>`，盐和哈希为 base64，新密码为 2 万次迭代，见 [决策：认证](/architecture/decisions/0004-auth.md) |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 注册时间 |
| `photo_visibility` | TEXT | 非空，默认 `'private'`，取值 `public` `unlisted` `private` | 新照片的默认公开范围，见 [下文](#新照片的默认公开范围) |

`handle` 的唯一约束自带索引，没有其他索引。

# 关系

- 一个用户拥有多张 [照片](/data/photos.md)、多个 [合集](/data/themes.md)、多条 [记录](/data/entries.md)、多个 [项目](/data/projects.md)、自己的 [标签](/data/tags.md) 和 [隐私区域](/data/privacy-zones.md)，删除用户时一并级联删除。
- [邀请码](/data/invites.md) 记录创建者和使用者；用户被删除后这两列置空。
- [地点](/data/pois.md) 的 `created_by` 指向创建者；用户被删除后置空，地点保留。
- 功能说明：[账号](/product/features/accounts.md)、[站点管理](/product/features/admin.md)。接口：[认证与站点](/api/auth.md)、[用户与管理](/api/users-admin.md)。

# 规则

- 站点里还没有任何用户时（`needsSetup`），第一次注册必须使用 `role = 'owner'` 的邀请码，注册者成为站长。写入方法见 [密钥与初始化](/runbooks/secrets.md)。
- 新用户的 `role` 取自所用邀请码的 `role`；开放注册（`registration = open`）且没带邀请码时为 `member`。
- 头像没有外键：删除照片时，Worker 要把引用该照片的 `avatar_photo_id` 置空。头像必须是本人的照片。

# 新照片的默认公开范围

上传时没有指定公开范围的照片按 `photo_visibility` 保存；上传页把每张新照片的公开范围预先设成它，可以逐张改。本人在 [设置](/product/features/accounts.md#设置-settings) 里修改（`PATCH /api/me`），只影响以后的上传，已有照片不变。

- 新注册的账号是 `private`，与记录、项目、合集的默认值一致：公开要由作者自己选。
- `0007_collections.sql` 之前就有的账号被设为 `public`，上传行为与之前相同，直到本人修改。迁移不改任何照片的公开范围。

为什么不直接把所有人的默认值改掉，见 [数据演进](/data/evolution.md#照片的默认可见性)。

# 隐私

- 公开：用户名、显示名、简介、头像、照片数、合集数（个人主页 `/@handle`）。
- 角色和 `photo_visibility` 只出现在本人的会话信息里（`SessionUser`），不出现在他人可见的 `UserPublic` 和 `UserProfile`。
- `password_hash` 只在登录校验时读取，不进入任何接口响应，也不写入日志。
