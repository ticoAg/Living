---
type: API
title: 导入接口
description: 把一份导出带进登录者自己的账号：先问哪些已经在这里，再一批批送来标签、地点、隐私区域、项目、记录和合集，照片照常上传。已经在的不动，同一份导出再导入一次不会多出东西。
tags: [api, import, export, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/import.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/worker/lib/ids.ts
    title: 导入给的 id
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [导入](/product/features/import.md)，导出文件的格式见 [导出接口](/api/export.md#导出的文件)。导入在浏览器里进行：浏览器读出 living.json 和照片文件，按下面的顺序一批批送来，Worker 每次只处理一批，所以档案再大，每次请求也在免费版的 CPU 时间之内。

# 顺序

1. `POST /api/import/resolve`：哪些照片、记录、项目、合集已经在这个账号里，其余的会是什么 id。
2. `POST /api/import/tags`、`/places`、`/zones`：标签、地点、隐私区域。
3. 照片：每张照常 `POST /api/photos`（[照片接口](/api/photos.md#post-apiphotos登录)），尺寸图在浏览器里从原文件重新生成，其余信息取自 living.json。
4. `POST /api/import/projects`、`/entries`、`/collections`：项目（带里程碑）、记录、合集（带条目）。

行照 living.json 里的样子送来（字段见 [living.json](/api/export.md#livingjson)），只有它指向的东西（照片、标签、项目、地点、记录、封面）要换成这个站点的 id：浏览器从前面几步的响应里得到对照表，换好再送。

# 规则

- 都需要登录，未登录返回 401。只写进登录者自己的账号，响应带 `Cache-Control: no-store`。
- **不覆盖，不删除**：已经在这里的东西保持现在的样子，导出里的版本不会盖过它。
- **已经在这里**：
  - 记录、项目、合集：导出里的 id 就是这个账号的（导出自这个账号，之后没有删），或者是这个账号以前导入它时给的 id。
  - 照片：这个账号有文件的 SHA-256 相同的照片（上传本来就这样判断重复，返回 409 和那张照片的 id）。
  - 标签、地点、隐私区域：见各自的接口。
- **导入给的 id**：新的记录、项目、合集和自建的地点，id 是前缀（`en_`、`pj_`、`th_`、`poi_`）加上「`living-import`、账号 id、导出里的 id」三行文字的 SHA-256，按 Crockford base32 取 26 个字符。同一个账号导入同一项，得到的总是同一个 id，所以再导入一次能认出它；别的账号的导入、以及普通的新建，都到不了这个 id，所以没有人能占用别人的 id，也不能让自己的东西出现在别人删掉的东西原来的地址上。里程碑和合集的条目跟着项目、合集一起新建，id 照常随机。
- **指向的东西**：记录里的照片、合集的照片条目和封面必须是自己的照片；记录、合集的记录条目必须是自己的记录；项目必须是自己的；标签必须是预置的或自己的；地点必须存在。不满足的不跟过来：从记录里去掉那张照片、标签、项目或地点，从合集里去掉那个条目，封面为空。导出里有、却没能导入的照片就这样从记录和合集里去掉。
- **检查**：每一行按普通的新建接口检查（字段、长度、日期、里程碑和条目的上限，记录不能是空的）。不过的那一行不导入，写进 `failed`（`id` 是导出里的 id，`message` 是原因），同一批的其他行照常。一批里同一个 id 出现两次，只算第一次。项目、记录、合集的行没有 `id` 或格式不对时，整个请求返回 400（这样的行在 `failed` 里说不清是哪一行）；标签和地点跳过这样的行。
- **时间**：`createdAt`、`updatedAt` 取导出里的，里程碑的也一样：必须是接口写出的那种 UTC 时间，晚于现在的按现在，修改时间早于创建时间的按创建时间；没有或格式不对时用现在。合集的 `publishedAt` 同样取导出里的；没有或格式不对时，公开的合集用创建时间，其余为空。记录的版本号从 1 开始。
- **公开范围**：照行里写的，没写时是仅自己可见。要全部改为仅自己可见，浏览器在送来之前改好。
- **数据库的额度**：免费版的 D1 每天能读写的行数用完后，这一天的查询都会失败，这时返回 503，`error` 为 `quota_exceeded`，说明协调世界时 0 点以后才能继续。不只导入，所有接口都这样返回。已经导入的部分留着，第二天再导入一次接着做。
- 请求体最多 2 MB（`/zones` 最多 256 KB），超过返回 413；数组超过下文的上限返回 400。

# 接口

一批的上限见 `IMPORT_LIMITS`（[shared/limits.ts](https://github.com/ticoAg/Living/blob/main/shared/limits.ts)）。

## `POST /api/import/resolve`

```json
{ "photos": ["<sha256>", "…"], "entries": ["en_…"], "projects": ["pj_…"], "collections": ["th_…"] }
```

每一项可选，各最多 1000 个；照片是文件的 SHA-256（64 位十六进制，不分大小写），其余是导出里的 id（`[A-Za-z0-9_-]`，最长 64）。格式不对返回 400。

```json
{
  "photos": { "<sha256>": "ph_…" },
  "entries": { "en_…": { "id": "en_…", "exists": true } },
  "projects": { "pj_…": { "id": "pj_…", "exists": false } },
  "collections": {}
}
```

- `photos`：这个账号里有这个 SHA-256 的照片，键是小写的 SHA-256；没有的不列出。
- 其余：每个 id 都列出，`id` 是它在这里的 id，`exists` 表示它已经在这里（见 [规则](#规则)）。`exists` 为 `false` 时，`id` 就是导入要给它的 id。

## `POST /api/import/tags`

```json
{ "tags": [{ "id": "t_…", "ownerId": "u_…", "parentId": "lake", "name": "断桥", "color": null, "sort": 10, "createdAt": "…" }] }
```

导出的 `tags` 整个送来（预置的和自己的，最多 2000 个），父标签和子标签可以在同一批。按父标签在前的顺序，逐个决定：

1. id 是这里的预置标签或自己的标签：就是它。
2. 否则，在它的父标签（换成这里的）下面，有同名的预置标签或自己的标签（名字的比较同标签管理：不分大小写和全半角）：就是那个。
3. 否则新建为自己的标签：名称、颜色、排序、创建时间取导出里的。

父标签不在这里也不在这一批时，放在根上（别人的标签算不在这里）。名称、颜色或排序不合要求的标签不导入，它的子标签放到它的父标签下。

```json
{ "ids": { "t_…": "t_…", "lake": "lake" }, "created": 3 }
```

`ids`：导出里的 id → 这里的 id，没导入的不列出。

## `POST /api/import/places`

```json
{ "places": [{ "id": "poi_…", "name": "断桥", "aliases": [], "category": "桥", "city": "杭州", "district": "西湖区", "lat": 30.26, "lng": 120.15, "radius": 120, "source": "osm", "sourceId": "way/123", "own": false }] }
```

地点是全站共用的，最多 500 个一批。逐个决定：

1. 这里有同 id 的地点（导出自这个站点）：就是它。
2. 来自地图服务（`source` 为 `amap` 或 `osm`，有 `sourceId`）：这里有同一个服务、同一个编号的地点就是它，否则新建（id 随机）。
3. 否则（自建的地点）：导入给的 id 已经在这里就是它，否则用这个 id 新建。

新建的地点算登录者建的，和上传照片时新建地点一样；名称、类别、坐标、城市、区县、匹配半径（限制在 10–5000 米）取导出里的，别名只有导出里 `own` 为 `true` 的地点才带过来。不合要求的地点（类别不对、没有坐标……）不导入。

```json
{ "ids": { "poi_…": "poi_…" }, "created": 1 }
```

## `POST /api/import/zones`

```json
{ "zones": [{ "name": "家", "lat": 30.27, "lng": 120.16, "radius": 300 }] }
```

最多 10 个一批。名称、中心和半径都相同的隐私区域已经在这里时不再新建（账号满了也算已经在这里）；一个账号最多 50 个，满了的不导入。新建的区域和在设置里新建一样：区域里已有的照片的位置随即隐藏。不合要求的区域不导入，半径和在设置里一样要在 50–5000 米之间，不会替它改到范围里。

```json
{ "created": 1, "existing": 0, "full": 0 }
```

## `POST /api/import/projects`

```json
{ "projects": [{ "id": "pj_…", "type": "learning", "title": "学吉他", "description": null, "startDate": "2026-10-01", "endDate": null, "status": "active", "visibility": "private", "createdAt": "…", "updatedAt": "…", "milestones": [{ "title": "第一首曲子", "body": null, "date": "2026-10-20", "createdAt": "…", "updatedAt": "…" }] }] }
```

最多 50 个一批。项目和它的里程碑一起新建；已经在这里的项目不动，也不补它的里程碑。

## `POST /api/import/entries`

```json
{ "entries": [{ "id": "en_…", "type": "note", "title": "西湖边", "body": "…", "occurredAt": "2026-11-16T15:30:00", "visibility": "private", "status": "published", "poiId": "poi_…", "createdAt": "…", "updatedAt": "…", "media": [{ "photoId": "ph_…", "caption": null }], "tagIds": ["lake"], "projectIds": ["pj_…"] }] }
```

最多 100 个一批，`media`、`tagIds`、`projectIds`、`poiId` 是这里的 id。草稿和已归档的照样导入。照片都没能跟过来、又没有标题和正文的记录是空的，不导入。

## `POST /api/import/collections`

```json
{ "collections": [{ "id": "th_…", "kind": "trip", "title": "杭州", "subtitle": null, "intro": null, "coverPhotoId": "ph_…", "startDate": "2026-11-15", "endDate": "2026-11-17", "visibility": "public", "createdAt": "…", "updatedAt": "…", "publishedAt": "…", "items": [{ "kind": "day", "day": "2026-11-15", "text": "到杭州", "photoId": null, "entryId": null }] }] }
```

最多 20 个一批，条目按数组的顺序，最多 1000 个。

项目、记录、合集三个接口的响应相同：

```json
{ "ids": { "en_…": "en_…" }, "created": 2, "existing": 1, "failed": [{ "id": "en_…", "message": "记录不能是空的：写点文字，或者加一张照片" }] }
```

`ids` 含这一批里现在在这里的每一行（新建的和已经在的），`created`、`existing` 是两者的数目。

# 用量

- Workers：每批一次请求，每张照片一次上传。2 万张照片、几千条记录的档案，约是两万多次请求，免费版每天 10 万次。
- D1：写入的行数约是导入的行数的几倍（每个索引另算一行），照片最多：每张约 10 行。免费版每天 10 万行写入，2 万张照片要两三天导完，额度用完时见 [规则](#规则)。
- R2：每张照片四个文件（原文件和三种尺寸图），R2 免费的 10 GB 存储也要算上。
- 详见 [费用](/architecture/cloudflare.md#费用)。
