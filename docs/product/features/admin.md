---
type: Feature
title: 站点管理
description: 站长和管理员发放邀请码、切换注册方式。
tags: [account, mvp]
route: "/settings"
area: studio
---
# 邀请码

- 生成：可选角色（成员 / 管理员）、备注、有效天数；邀请码为 10 位易读字符（去掉 0O1IL）。
- 列表：未使用、已使用（使用者、时间）、已过期；可删除未使用的邀请码。

# 注册方式

`invite`（默认）/ `open` / `closed`，存于 D1 `settings` 表的 `registration` 键。

# 首次启动

部署后数据库里有一个角色为 `owner` 的一次性邀请码，由部署者写入（见 [密钥与初始化](/runbooks/secrets.md)），用它注册第一个账号即成为站长。
