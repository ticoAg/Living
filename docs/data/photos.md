---
type: D1 Table
title: photos
description: 照片：位置、拍摄参数、文件键、尺寸图信息、可见性和位置精度；坐标始终存原值，对他人的精度在读取时处理。
tags: [data, d1, photos, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# Schema

## 基本信息

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `ph_<ulid>` |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 所有者 |
| `title` | TEXT | 可空 | 标题；为空时界面用地点名 |
| `note` | TEXT | 可空 | [照片笔记](/product/features/photo-notes.md)，纯文本，最长 5000 字 |
| `uploaded_at` | TEXT | 非空，默认当前 UTC 时间 | 上传时间 |
| `updated_at` | TEXT | 可空 | 最近一次修改（UTC）；从未修改为空 |

## 时间与位置

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `taken_at` | TEXT | 可空 | 拍摄的本地时间 `YYYY-MM-DDTHH:mm:ss`，不带时区 |
| `tz` | TEXT | 可空 | 拍摄时的时区偏移，如 `+08:00` |
| `lat` | REAL | 可空 | 纬度，WGS-84，存原值 |
| `lng` | REAL | 可空 | 经度，WGS-84，存原值 |
| `alt` | REAL | 可空 | 海拔（米） |
| `heading` | REAL | 可空 | 镜头朝向，度，自北顺时针 0–360 |
| `geo_privacy` | TEXT | 非空，默认 `'exact'`，取值 `exact` `fuzzy` `hidden` | 位置精度，对他人生效 |
| `city` | TEXT | 可空 | 逆地理得到的城市，始终对所有人可见 |
| `district` | TEXT | 可空 | 区县；`hidden` 时对他人隐藏 |

## 地点匹配

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `poi_id` | TEXT | 可空，外键 → `pois.id`，删除时置空 | 匹配到的 [地点](/data/pois.md) |
| `poi_distance` | REAL | 可空 | 拍摄点到地点中心的距离（米），服务端重新计算 |
| `poi_method` | TEXT | 可空，取值 `auto` `confirmed` `inferred` `manual` | 匹配方式：自动、用户确认、按时间推断、手动 |

## 器材

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `camera` | TEXT | 可空 | 相机型号 |
| `lens` | TEXT | 可空 | 镜头 |
| `focal` | REAL | 可空 | 焦距（毫米） |
| `focal35` | REAL | 可空 | 等效焦距（35 mm） |
| `aperture` | REAL | 可空 | 光圈值 |
| `shutter` | TEXT | 可空 | 快门，如 `1/250` |
| `iso` | INTEGER | 可空 | ISO |

## 文件与展示

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `width` | INTEGER | 非空 | 显示方向下的像素宽度，瀑布流据此占位 |
| `height` | INTEGER | 非空 | 显示方向下的像素高度 |
| `file_key` | TEXT | 非空 | 原图的 R2 键 `o/<ownerId>/<photoId>.<ext>`，见 [R2 媒体文件](/data/media.md) |
| `file_type` | TEXT | 可空 | 原图的 MIME 类型，如 `image/jpeg`、`image/heic`、`image/heif` |
| `file_size` | INTEGER | 可空 | 原图字节数 |
| `variants` | TEXT | 非空 | JSON：`{"s":{"key","w","h"},"m":{…},"l":{…}}`，`key` 如 `v/<photoId>/s.webp`，长边 480 / 1600 / 2560 |
| `thumbhash` | TEXT | 可空 | ThumbHash 编码串，浏览器生成，加载前的模糊占位 |
| `palette` | TEXT | 可空 | JSON 数组，最多 5 个主色（十六进制），最主要的在前 |
| `focus_x` | REAL | 可空 | 裁切焦点的横向位置，0–1 |
| `focus_y` | REAL | 可空 | 裁切焦点的纵向位置，0–1 |
| `sha256` | TEXT | 可空 | 原图的 SHA-256，浏览器计算，用于同一用户去重 |

## 可见性与状态

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `visibility` | TEXT | 非空，默认 `'public'`，取值 `public` `unlisted` `private` | 谁能看到这张照片 |
| `in_living` | INTEGER | 非空，默认 `1` | 是否参与 [Living 模式](/product/features/living-mode.md) 轮播 |
| `favorite` | INTEGER | 非空，默认 `0` | 收藏；Living 里出现概率加倍 |

## 索引

- `photos_owner_sha`：唯一，`(owner_id, sha256)`，仅 `sha256` 非空的行。同一用户重复上传同一文件时返回 409。
- `photos_owner_taken`（`owner_id`, `taken_at`）：个人主页按时间排序。
- `photos_visibility_taken`（`visibility`, `taken_at`）：首页公开照片按时间排序。
- `photos_poi`（`poi_id`）：地点页取该地点的照片。

# 关系

- 所有者 [users](/data/users.md)：删除用户时照片级联删除。
- 地点 [pois](/data/pois.md)：`poi_id`，地点删除时置空。
- 标签：通过 [photo_tags](/data/photo-tags.md) 多对多关联 [tags](/data/tags.md)。
- 主题：[theme_items](/data/theme-items.md) 的 `photo_id` 引用照片，照片删除时条目级联删除；[themes](/data/themes.md) 的 `cover_photo_id` 引用封面，删除时置空。
- 头像：`users.avatar_photo_id` 指向照片但没有外键，删除照片时由 Worker 置空。
- 文件：R2 中的原图和三种尺寸图，D1 外键管不到，删除照片时由 Worker 一并删除。
- 功能说明：[上传与整理](/product/features/upload.md)、[照片详情](/product/features/photo-detail.md)、[图库](/product/features/gallery.md)、[隐私](/product/features/privacy.md)。接口：[照片接口](/api/photos.md)。

# 可见性与隐私

`visibility` 决定谁能看到这张照片，`geo_privacy` 决定看到的人能看到多少位置，两者独立。规则见 [接口约定](/api/conventions.md#位置精度对非所有者)。

| 请求者 | 能看到 |
|---|---|
| 本人 | 全部照片，位置为原值 |
| 他人，`public` | 出现在列表、地图、索引、Living；位置按 `geo_privacy` 处理 |
| 他人，`unlisted` | 只在按 id 取详情时可见，不进入列表、计数和 Living |
| 他人，`private` | 不可见，按 404 处理 |

位置精度对他人的效果：

| `geo_privacy` | `lat` `lng` | `heading` `alt` | `poi_id` `poi_distance` | `district` |
|---|---|---|---|---|
| `exact` | 原值 | 原值 | 原值 | 原值 |
| `fuzzy` | 取整到约 500 米 | 隐藏 | 原值 | 原值 |
| `hidden` | 隐藏 | 隐藏 | 隐藏 | 隐藏 |

- 表里始终存原始坐标；精度处理发生在 Worker 组装响应时。任何新增的查询只要返回照片，都必须走同一套处理。
- 创建照片时，坐标落在本人任一 [隐私区域](/data/privacy-zones.md) 内，`geo_privacy` 强制为 `hidden`。已发布的照片不会因为新增区域而被改写。
- `file_key` 不出现在接口响应里；原图只能由所有者经 `/media/o/…` 读取。
- 地图、地点页只统计位置未隐藏的照片。

# Examples

```sql
-- 地图和地点列表的计数：对访客可见、位置未隐藏、已匹配地点
SELECT poi_id, COUNT(*) AS n
FROM photos
WHERE visibility = 'public' AND geo_privacy <> 'hidden' AND poi_id IS NOT NULL
GROUP BY poi_id;
```
