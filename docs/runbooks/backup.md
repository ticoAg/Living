---
type: Runbook
title: 备份与恢复
description: 站长备份整站：D1 用 wrangler d1 export 导出成 SQL，R2 用 rclone 复制到自己的硬盘；恢复时先导入新库、核对后再换上。Time Travel 只管最近 7 天的 D1。托管存储不等于本地自托管。
tags: [runbook, backup, cloudflare]
sources:
  - resource: https://developers.cloudflare.com/d1/best-practices/import-export-data/
    title: D1 的导入与导出
  - resource: https://developers.cloudflare.com/d1/reference/time-travel/
    title: D1 Time Travel
  - resource: https://developers.cloudflare.com/r2/examples/rclone/
    title: 用 rclone 读写 R2
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: 资源的名字和 id
---
# 存在哪里

| 数据 | 存放 | Cloudflare 自带的保护 | 自己的备份 |
|---|---|---|---|
| 账号、记录、照片的信息（D1 `living`） | 站长的 Cloudflare 账号 | Time Travel：恢复到最近任意一分钟，免费版 7 天、付费版 30 天 | [导出 D1](#导出-d1) |
| 照片和附件的文件（R2 `living-photos`：原图 `o/`，三种尺寸 `v/`，附件 `a/`） | 站长的 Cloudflare 账号 | 多副本存储；删掉的文件找不回来 | [复制 R2](#复制-r2) |
| 会话和登录限流（KV） | 站长的 Cloudflare 账号 | 无 | 不用备份：丢了只是大家要重新登录 |
| 密钥（`AMAP_KEY`、站长引导邀请码） | Worker 的密钥，写进去就读不出来 | 无 | 存在自己的密码管理器里，见 [密钥与初始化](/runbooks/secrets.md) |

Cloudflare 托管的存储不等于本地自托管。数据在站长的 Cloudflare 账号里，存储本身很可靠，但账号出问题（登录不了、被停用、误删了库或桶）、或者 Living 自己的 bug 和误操作，都会连带全部数据；Time Travel 也只能回到 7 天以内。存在自己硬盘上的备份，是唯一不依赖这个账号的一份。

每个人也可以在设置里 [导出](/product/features/export.md) 自己的档案。这里的备份是整个站点，包括每个账号仅自己可见的照片、原图的 EXIF 和位置：

- 存在只有自己能读的地方（加密的硬盘或备份盘）。
- 不要放进仓库，不要做成 GitHub Actions 的构件，也不要上传到公开的网盘：仓库可能是公开的。

# 备份

D1 和 R2 一起备份：D1 里的行指向 R2 里的文件，同一时间的两份才对得上。建议每月一次，以及每次做大的改动（迁移、批量删除）之前。

## 导出 D1

```bash
npx wrangler d1 export living --remote --output=living-$(date +%F).sql
```

- 导出整个库的表结构和数据，包括记录迁移进度的 `d1_migrations` 表，这份文件可以原样导回 D1。D1 导出不支持虚拟表，所以 Living 不建 FTS5 全文索引，见 [数据演进](/data/evolution.md#搜索)。
- 导出进行时数据库不处理其他请求：页面会停顿几秒到几十秒，选人少的时候做。
- 这份 SQL 同样含有每个人的私密内容，按上面的要求保管。

## 复制 R2

用 R2 的 S3 接口和 [rclone](https://rclone.org/) 把整个桶复制到本地：

1. Cloudflare 控制台 › R2 › Manage API tokens，新建一个 **Object Read only** 的令牌，只给 `living-photos` 这个桶，记下 Access Key ID 和 Secret Access Key。
2. `rclone config` 新建一个 S3 远端，命名 `r2`：provider 选 Cloudflare，endpoint 是 `https://<账号 id>.r2.cloudflarestorage.com`。
3. 复制：

```bash
rclone copy r2:living-photos /backup/living-photos --progress
```

- `copy` 只补上本地没有的文件，不删本地的，所以本地是一份只增不减的备份：R2 里误删的文件在这里还在。不要用 `sync`，它会把 R2 里删掉的也删掉。
- 原图和三种尺寸都要：尺寸图是上传时在浏览器里生成的，没有工具能从原图重新生成。附件 `a/` 也在同一个桶里，一起复制；没传完的分片上传不是对象，不会复制。
- 每张照片读一次算一次 R2 的 B 类操作，免费额度每月 1000 万次，整桶复制一次在额度之内；R2 没有出站流量费。

# 恢复

## 最近 7 天内的误操作

用 D1 的 Time Travel，见 [部署 › 数据库恢复](/runbooks/deploy.md#数据库恢复)。它把整个库恢复到某一分钟，那一分钟之后所有人写下的东西都会没有；命令返回的 bookmark 可以撤销这次恢复。照片文件不在其中：恢复到删除照片之前，照片的信息回来了，R2 里的文件却已经删掉，要从 R2 的备份补回来，见 [恢复 R2](#恢复-r2)。

## 恢复 D1

先导入一个新库，核对无误后再让 Worker 改用它：

1. 新建一个库，记下输出里的 `database_id`：

   ```bash
   npx wrangler d1 create living-restored
   ```

2. 导入（文件最大 5 GiB）：

   ```bash
   npx wrangler d1 execute living-restored --remote --file=living-2026-11-17.sql
   ```

3. 核对：数一数主要的表，和备份时对一对；再看迁移，比备份新的迁移会列在这里，部署时自动补上：

   ```bash
   npx wrangler d1 execute living-restored --remote --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM photos) AS photos, (SELECT COUNT(*) FROM entries) AS entries"
   ```

   ```bash
   npx wrangler d1 migrations list living-restored --remote
   ```

4. 换上：`wrangler.jsonc` 的 `d1_databases` 里，`database_name` 改成 `living-restored`，`database_id` 改成新库的 id；`package.json` 的 `db:migrate:remote`、`deploy` 和 Workers Builds 的部署命令（[构建与发布](/architecture/ci-cd.md)）里的库名 `living` 一并改掉。推送 main，部署之后 Worker 就读新库。
5. 旧库留一阵再删（`npx wrangler d1 delete living`），删掉后 7 天内还能用 D1 的 undelete 找回。

## 恢复 R2

用一个 **Object Read & Write** 的令牌，把本地备份复制回去：

```bash
rclone copy /backup/living-photos r2:living-photos --progress
```

`copy` 只补上桶里没有的文件，不改已有的。整个桶没了时，新建一个桶，复制进去，把 `wrangler.jsonc` 里 `r2_buckets` 的 `bucket_name` 改成新桶的名字再部署。

D1 和 R2 恢复到不同时间时：

- R2 里多出来的文件（备份之后上传的照片）没有行指向它们，不影响使用，只占空间。
- D1 里有、R2 里没有的文件，图片打不开；导出时用大图代替缺了的原图，大图也没有就只留信息，见 [导出](/product/features/export.md#规则)。

## KV 和密钥

- KV 丢了：新建一个命名空间（`npx wrangler kv namespace create living-kv`），把 `wrangler.jsonc` 里 `kv_namespaces` 的 `id` 换掉再部署；大家重新登录一次。
- 密钥：重新 `npx wrangler secret put`，见 [密钥与初始化](/runbooks/secrets.md)。

# 还不能做的

- 只恢复一个人的数据：D1 的导出和 Time Travel 都是整个库。本人有自己的导出时，[导入](/product/features/import.md) 它就能找回删掉的记录、照片、项目和合集（换了新地址）。没有导出时，要找回某个人误删的一条记录，可以把备份导入一个单独的本地库（`npx wrangler d1 execute living --local --persist-to=/tmp/living-restore --file=…`），查出那几行，再用 `--remote --command` 写回去。
