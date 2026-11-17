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
- 保留用户名：admin、api、media、living、login、register、settings、studio、themes、upload、map、index、today、archive、entries、projects、search 等。

# 登录与会话

- 登录或注册后来到 [今天](/product/features/today.md)；从某个页面被要求登录的，回到那个页面。
- 用户名 + 密码；密码用 PBKDF2-SHA256（2 万次迭代、16 字节盐）存储，迭代次数随哈希保存，以后可以提高。
- 会话令牌放在 HttpOnly、Secure、SameSite=Lax 的 Cookie 里，服务端存于 KV，30 天有效。
- 同一 IP 对同一用户名每分钟最多 5 次登录尝试。

## 会话过期

会话过了 30 天，或在别处退出后，页面并不知道，直到下一次请求被拒绝（401）：

- 页眉立即变为未登录，页面上弹出「重新登录」对话框，用户名已填好。登录后留在原页面，填写的内容（设置里的简介、上传队列）都还在，再点一次保存或发布即可。
- 对话框可以按「稍后」或 Esc 关掉；这时点页眉的「登录」会重新打开它，不离开当前页面。
- 登录接口自身的 401（比如密码错误）只在表单里提示，不算会话过期。

# 个人主页 `/@handle`

显示名、简介、头像（取自己的一张照片）、照片数、合集数，有记录、项目时还有记录数、项目数；下面是该用户的公开合集、已完成的 [记录](/product/features/entries.md)（他人只看到公开的，草稿和已归档的不在这里）和照片图库（可筛选、可 Living）。

# 设置 `/settings`

修改显示名、简介、头像、密码；选择新照片的默认公开范围（公开、仅链接、仅自己）；管理 [隐私区域](/product/features/privacy.md) 和自己的全部 [分享链接](/product/features/sharing.md)（复制或删除）；[导出](/product/features/export.md) 自己的整个档案；站长和管理员还能看到 [站点管理](/product/features/admin.md)。

新照片的默认公开范围：新账号是「仅自己」，这项设置出现之前就有的账号是「公开」。它只决定上传页给新照片预先选好的公开范围，改了之后已经上传的照片不变，见 [隐私](/product/features/privacy.md#新照片)。
