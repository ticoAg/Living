---
type: Feature
title: 账号
description: 邀请码注册、用户名加密码登录、个人主页；第一位注册的用户使用站长邀请码成为站长。
tags: [account, mvp]
route: "/login, /register, /@:handle, /settings"
area: studio
---
# 注册

- 字段：邀请码、用户名（3–24 位，字母数字下划线连字符，不区分大小写，唯一）、显示名、密码（至少 8 位）。
- 注册方式由站点设置决定：`invite`（默认，需要邀请码）、`open`（任何人）、`closed`（不开放）。
- 站点还没有任何用户时，只有角色为 `owner` 的邀请码能注册，注册者成为站长。
- 保留用户名：admin、api、media、living、login、register、settings、studio、themes、upload、map、index 等。

# 登录与会话

- 用户名 + 密码；密码用 PBKDF2-SHA256（2 万次迭代、16 字节盐）存储，迭代次数随哈希保存，以后可以提高。
- 会话令牌放在 HttpOnly、Secure、SameSite=Lax 的 Cookie 里，服务端存于 KV，30 天有效。
- 同一 IP 对同一用户名每分钟最多 5 次登录尝试。

# 个人主页 `/@handle`

显示名、简介、头像（取自己的一张照片）、照片数、主题数；下面是该用户的照片图库（可筛选、可 Living）和公开主题。

# 设置 `/settings`

修改显示名、简介、头像、密码；管理 [隐私区域](/product/features/privacy.md)；站长和管理员还能看到 [站点管理](/product/features/admin.md)。
