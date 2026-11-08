---
type: D1 Table
title: pois
description: 地点：名称、类别、中心点和匹配半径；来源可以是用户自建、高德或 OpenStreetMap。自建地点在被公开照片使用前只有创建者能匹配和搜到。
tags: [data, d1, places]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `poi_<ulid>` |
| `name` | TEXT | 非空 | 地点名 |
| `aliases` | TEXT | 可空 | 别名，JSON 数组文本，如 `["断桥残雪"]`；名称搜索时与 `name` 一起做包含匹配 |
| `category` | TEXT | 非空，默认 `'景'` | 类别，取值见 `shared/types.ts` 的 `POI_CATEGORIES`（桥 堤 湖 山 塔 寺 亭 园 岛 村 景 街区 建筑 美术馆 海岸 店 道路），表上不做 `CHECK` |
| `city` | TEXT | 可空 | 城市 |
| `district` | TEXT | 可空 | 区县 |
| `lat` | REAL | 非空 | 中心点纬度，WGS-84 |
| `lng` | REAL | 非空 | 中心点经度，WGS-84 |
| `radius` | REAL | 非空，默认 `120` | 匹配半径（米）。按类别取默认值，见 `shared/geo.ts` 的 `CATEGORY_RADIUS`（桥 60、寺 150、山 400、湖 600 等） |
| `source` | TEXT | 非空，默认 `'custom'`，取值 `custom` `amap` `osm` | 来源 |
| `source_id` | TEXT | 可空 | 外部来源里的 id；自建地点为空 |
| `created_by` | TEXT | 可空，外键 → `users.id`，删除时置空 | 创建者，创建者和管理员可以修改 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |

索引：

- `pois_source`：唯一，`(source, source_id)`，仅 `source_id` 非空的行。外部候选被选中时按它去重。
- `pois_latlng`（`lat`, `lng`）：按坐标范围预筛附近地点。

# 关系

- [photos](/data/photos.md) 通过 `poi_id` 引用地点；地点被删除时 `poi_id` 置空。
- `created_by` 指向 [users](/data/users.md)。
- 功能说明：[地点匹配](/product/features/poi-matching.md)、[地点页](/product/features/places.md)、[地图](/product/features/map.md)。接口：[地点接口](/api/pois.md)。数据源选择见 [决策：地点数据源](/architecture/decisions/0003-poi-providers.md)。

# 规则

- 所有用户共用同一张表：一个人建的地点，别人上传时也能匹配到。
- 表里只有中心点和匹配半径，不存多边形。
- 外部候选只在被选中时才写入，不批量抓取；按 `(source, source_id)` 去重，已有则复用。
- 坐标一律 WGS-84。高德返回的 GCJ-02 坐标在写入前转回。

# 隐私

- 表上没有可见性字段，由使用它的照片决定。`POST /api/pois/match`（按位置）和 `GET /api/pois/search`（按名称）提供给某个用户的站内地点是：高德和 OpenStreetMap 来源的地点；他自己建的地点；以及至少有一张照片使用的自建地点，这张照片是他自己的，或者是公开且位置未隐藏的。别人只用在私密、仅链接可见或隐藏位置的照片上的自建地点，不会出现在他的匹配和搜索里。
- `GET /api/pois/:id` 不要求登录，按 id 返回任何地点；id 是不可猜的 ULID，只有位置可见的照片会带出它。
- 访客可见的列表 `GET /api/pois` 只返回至少有一张对请求者可见、且位置未隐藏的照片的地点；`geo_privacy = 'hidden'` 的照片不会让它的地点出现。
- 给家这样的私密位置建的自建地点，在有公开且显示位置的照片用上它之前，只有自己看得到；落在隐私区域内的照片本来就会被强制设为 `hidden`。
