---
type: D1 Table
title: invites
description: 邀请码：角色、备注、使用者和有效期；站长引导邀请码也存在这里。
tags: [data, d1, account, admin]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `code` | TEXT | 主键 | 邀请码。接口生成的是 10 位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`；站长引导邀请码由部署者直接写库，内容任意 |
| `created_by` | TEXT | 可空，外键 → `users.id`，删除时置空 | 创建者；直接写库的邀请码为空 |
| `role` | TEXT | 非空，默认 `'member'`，取值 `owner` `admin` `member` | 使用者注册后获得的角色。接口只能生成 `member` 和 `admin`（且只有站长能生成 `admin`），`owner` 只能直接写库 |
| `note` | TEXT | 可空 | 备注，如发给谁 |
| `used_by` | TEXT | 可空，外键 → `users.id`，删除时置空 | 使用者 |
| `used_at` | TEXT | 可空 | 使用时间（UTC）；空表示未使用 |
| `expires_at` | TEXT | 可空 | 过期时间（UTC）；空表示不过期 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |

主键之外没有索引，表很小。

# 关系

- `created_by`、`used_by` 指向 [users](/data/users.md)。
- 注册时的用法见 [认证接口](/api/auth.md)；生成、列出、删除见 [用户与管理接口](/api/users-admin.md)；产品规则见 [站点管理](/product/features/admin.md) 和 [账号](/product/features/accounts.md)。
- 站长引导邀请码的写入与轮换见 [密钥与初始化](/runbooks/secrets.md)。

# 状态

| 状态 | 条件 |
|---|---|
| 可用 | `used_at IS NULL`，且 `expires_at` 为空或晚于当前时间 |
| 已使用 | `used_at` 非空 |
| 已过期 | `used_at IS NULL`，且 `expires_at` 不晚于当前时间 |

判断是否已使用要看 `used_at`：使用者账号被删除后 `used_by` 会置空，但邀请码不应因此重新可用。

# 规则

- 使用邀请码时，Worker 在一个 D1 batch 里先条件写入用户（要求邀请码仍未使用、未过期；站点初始化阶段还要求库里仍没有任何用户），再把邀请码标为已使用。条件落空（影响行数不为 1）说明被别人抢先用掉，返回 409，所以两个人不能同时用同一个码。`used_by` 有外键，因此先有用户、后更新邀请码。
- 查询和删除邀请码时按不区分大小写匹配（`COLLATE NOCASE`），不要创建只在大小写上不同的两个码。
- 已使用的邀请码不能删除（接口返回 409）；未使用的可以删除。
- 邀请码等同于注册凭证，只通过 owner / admin 的接口返回，不写入日志。

# Examples

```sql
-- 校验：邀请码是否可用
SELECT code, role FROM invites
WHERE code = ?1 COLLATE NOCASE
  AND used_at IS NULL
  AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
```
