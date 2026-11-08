---
type: D1 Table
title: settings
description: 站点级键值设置；目前只有注册方式 registration，默认 invite。
tags: [data, d1, admin]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `key` | TEXT | 主键 | 设置名 |
| `value` | TEXT | 非空 | 设置值，文本 |

# 设置项

| `key` | 取值 | 默认 | 说明 |
|---|---|---|---|
| `registration` | `invite` `open` `closed` | `invite` | 注册方式：需要邀请码 / 任何人 / 不开放。迁移用 `INSERT OR IGNORE` 写入默认值 |

表上没有 `CHECK`，取值由 `PATCH /api/admin/settings` 校验。

# 关系

- 独立的键值表，不与其他表关联。
- `registration` 通过 `GET /api/site` 对所有人可见（见 [认证与站点](/api/auth.md)）；修改见 [用户与管理接口](/api/users-admin.md)。产品规则见 [站点管理](/product/features/admin.md) 和 [账号](/product/features/accounts.md)。

# 规则

- 新增设置项时，在新的迁移里用 `INSERT OR IGNORE` 写入默认值，代码读取时仍要为缺失的键准备默认值。
- 只有站长和管理员能修改。
