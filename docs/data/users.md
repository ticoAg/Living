---
type: D1 Table
title: users
description: 账号：用户名、显示名、角色和密码哈希。
tags: [data, d1, account]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
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

`handle` 的唯一约束自带索引，没有其他索引。

# 关系

- 一个用户拥有多张 [照片](/data/photos.md)、多个 [主题](/data/themes.md)、自己的 [标签](/data/tags.md) 和 [隐私区域](/data/privacy-zones.md)，删除用户时一并级联删除。
- [邀请码](/data/invites.md) 记录创建者和使用者；用户被删除后这两列置空。
- [地点](/data/pois.md) 的 `created_by` 指向创建者；用户被删除后置空，地点保留。
- 功能说明：[账号](/product/features/accounts.md)、[站点管理](/product/features/admin.md)。接口：[认证与站点](/api/auth.md)、[用户与管理](/api/users-admin.md)。

# 规则

- 站点里还没有任何用户时（`needsSetup`），第一次注册必须使用 `role = 'owner'` 的邀请码，注册者成为站长。写入方法见 [密钥与初始化](/runbooks/secrets.md)。
- 新用户的 `role` 取自所用邀请码的 `role`；开放注册（`registration = open`）且没带邀请码时为 `member`。
- 头像没有外键：删除照片时，Worker 要把引用该照片的 `avatar_photo_id` 置空。头像必须是本人的照片。

# 隐私

- 公开：用户名、显示名、简介、头像、照片数、主题数（个人主页 `/@handle`）。
- 角色只出现在本人的会话信息里（`SessionUser`），不出现在他人可见的 `UserPublic` 和 `UserProfile`。
- `password_hash` 只在登录校验时读取，不进入任何接口响应，也不写入日志。
