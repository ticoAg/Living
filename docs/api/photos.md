---
type: API
title: 照片接口
description: 照片列表、详情、multipart 上传、修改与删除。
tags: [api, photos]
---
# GET /api/photos

返回 `{ "photos": PhotoSummary[] }`，按 `takenAt` 倒序（无拍摄时间的按上传时间排在最后），上限 5000。

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

处理：

1. 同一用户已有相同 `sha256` → 409 `{ "error": "duplicate", "photoId": "..." }`。
2. 新 id `ph_<ulid>`；原图写入 `o/<ownerId>/<photoId>.<ext>`，尺寸图写入 `v/<photoId>/<s|m|l>.<webp|jpg>`，均带 `contentType`。
3. 地点：`poiId` 存在则使用；否则 `newPoi` 按 `(source, sourceId)` 查找或新建（`created_by` 为请求者，半径按类别默认）。有坐标时服务端重新计算 `poi_distance`。`province`、`city`、`district` 原样保存（各最多 60 个字符），前端取自地点匹配的结果；`province` 为空的照片之后由每小时的补全任务查询。
4. 坐标落在请求者的任一隐私区域内 → `geo_privacy` 强制为 `hidden`。
5. 写入 `photo_tags`：`tagIds` 为 `manual`，`suggestedTagIds` 为 `suggested`；只接受预置标签和请求者自己的标签。
6. `themeIds` 中属于请求者的主题，在末尾追加照片条目。
7. 用 D1 batch 一次写入。R2 写入失败时返回 502 且不写 D1。

返回 201 `{ "photo": PhotoDetail }`。

# PATCH /api/photos/:id（本人）

`UpdatePhotoBody`。`tagIds` 替换全部标签（来源记为 `manual`）；`poiId: null` 解除地点；`newPoi` 同上传。返回 `{ "photo": PhotoDetail }`，并更新 `updated_at`。

# DELETE /api/photos/:id（本人）

删除 R2 中原图和三种尺寸、D1 行（标签关联与主题条目级联删除；用作封面或头像的引用置空）→ `{ "ok": true }`。
