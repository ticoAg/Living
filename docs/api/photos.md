---
type: API
title: 照片接口
description: 照片列表、详情、multipart 上传、修改与删除。
tags: [api, photos]
---
# GET /api/photos

返回 `{ "photos": PhotoSummary[], "truncated": boolean }`（`PhotoListResponse`），按 `takenAt` 倒序（无拍摄时间的按上传时间排在最后）。

- 一次最多 5000 张（`shared/types.ts` 的 `PHOTO_LIST_LIMIT`），没有分页。符合条件的照片更多时，只返回最新的 5000 张，`truncated` 为 `true`；更早的照片不出现在这次的结果里，所以也不出现在图库、地图、索引、Living 和照片页的上一张、下一张里。图库、地图和索引这时显示一行「只显示最近的 5000 张」。
- `truncated` 由多查一行判断：查询取 5001 行，有第 5001 行就是被截断了，这一行不返回。

| 参数 | 含义 |
|---|---|
| （无） | 所有用户的 `public` 照片 |
| `owner=<handle>` | 该用户对请求者可见的照片；本人请求时包含 `unlisted` 与 `private` |
| `mine=1` | 请求者自己的全部照片（需登录） |
| `poi=<id>` | 该地点的可见照片（可与 `owner` 组合） |
| `ids=<id,id,…>` | 指定照片（最多 200 张），只返回可见的 |

`PhotoSummary.tagIds` 为直接标签；`hasNote` 表示有笔记；坐标和 `district` 按 [位置精度](/api/conventions.md#位置精度对非所有者) 处理。`province`、`city`、`district` 是逆地理编码得到的省、市、区县，[地图](/product/features/map.md) 用它们把照片合成图集；查过但没有省份的读作 `null`，见 [photos](/data/photos.md#省市区县)。

# GET /api/photos/:id

`PhotoDetail`。`private` 且非本人 → 404；`unlisted` 可按 id 访问。`themes` 只列请求者可见的主题。

# POST /api/photos（登录）

`multipart/form-data`：

| 部分 | 内容 |
|---|---|
| `meta` | JSON 字符串，`CreatePhotoMeta` |
| `original` | 原始文件，≤ 50 MB |
| `s` `m` `l` | 尺寸图，`image/webp` 或 `image/jpeg`，长边 480 / 1600 / 2560 |

处理按以下顺序，每一步是 `worker/lib/upload.ts` 里的一个函数：

1. 读表单：请求过大 → 413；不是 `multipart/form-data` → 400；再依次检查 `meta`、`original`、`s` `m` `l`，第一个不合规的部分决定错误。
2. 落库前的查询，都在写存储之前：
   - 同一用户已有相同 `sha256` → 409 `{ "error": "duplicate", "photoId": "..." }`。
   - `poiId` 指向的地点不存在 → 400。
   - 坐标落在请求者的任一隐私区域内 → `geo_privacy` 强制为 `hidden`。
   - 标签：`tagIds` 记为 `manual`，`suggestedTagIds` 记为 `suggested`（上传页已不再发送它，与 `tagIds` 重复的不再记）；只接受预置标签和请求者自己的标签。
   - 主题：`themeIds` 中只保留属于请求者的主题。
3. 写 R2：新 id `ph_<ulid>`；原图写入 `o/<ownerId>/<photoId>.<ext>`，尺寸图写入 `v/<photoId>/<s|m|l>.<webp|jpg>`，均带 `contentType`。任一文件写入失败 → 删掉已写入的文件，返回 502，不写 D1。
4. 落库：
   - 地点：`poiId` 存在则使用；否则 `newPoi` 按 `(source, sourceId)` 查找或新建（`created_by` 为请求者，半径按类别默认）。有坐标时服务端重新计算 `poi_distance`。`province`、`city`、`district` 原样保存（各最多 60 个字符），前端取自地点匹配的结果；`province` 为空的照片之后由每小时的补全任务查询。
   - 用 D1 batch 一次写入照片行、`photo_tags`，以及在每个主题末尾追加的照片条目（同时更新主题的 `updated_at`）。
   - 这一步失败时删掉第 3 步写入的文件。若失败原因是同一 `sha256` 的另一次上传抢先写入（唯一约束冲突），返回 409 和那张照片的 id，与第 2 步相同。

返回 201 `{ "photo": PhotoDetail }`。

# PATCH /api/photos/:id（本人）

`UpdatePhotoBody`。`tagIds` 替换全部标签（来源记为 `manual`）；`poiId: null` 解除地点；`newPoi` 同上传。返回 `{ "photo": PhotoDetail }`，并更新 `updated_at`。

# DELETE /api/photos/:id（本人）

删除 R2 中原图和三种尺寸、D1 行（标签关联与主题条目级联删除；用作封面或头像的引用置空）→ `{ "ok": true }`。
