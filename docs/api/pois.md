---
type: API
title: 地点接口
description: 地点列表与详情、按坐标匹配候选、按名称搜索、新建与修改地点。
tags: [api, places]
---
# GET /api/pois

`{ "pois": Poi[] }`：至少有一张对请求者可见、且位置未隐藏的照片的地点，`count` 为这些照片数。参数 `owner=<handle>` 只统计该用户的照片。

# GET /api/pois/:id

`{ "poi": Poi, "nearby": (Poi & { "distance": number })[] }`：附近 5 公里内、有可见照片的地点，按距离最多 8 个。

# POST /api/pois/match（登录）

请求 `MatchRequest` → `MatchResponse`。

1. 站内候选：`pois` 中距离 ≤ `max(radius, poi.radius)` 且对请求者开放的地点（别人的自建地点要有公开且位置未隐藏的照片在用，见 [pois 的隐私](/data/pois.md#隐私)）；`radius` 默认 300，最大 1000。
2. 外部候选：有 `AMAP_KEY` 且坐标在中国境内时调用高德 `v3/place/around`（坐标先转 GCJ-02，结果转回 WGS-84，按距离排序，最多 25 个）；否则 Overpass（`nwr(around:R)` 查询带名称的 tourism、historic、leisure=park/garden、natural、man_made=bridge/tower/pier、bridge、amenity=place_of_worship/cafe/restaurant/library/arts_centre/theatre、place=square/village/neighbourhood/island）。
3. 与站内候选去重：相同 `source + sourceId`，或同名且相距 < 80 米。
4. 类别：由高德类型或 OSM 标签映射，再按名称后缀（桥 湖 山 寺 塔 岛 村 园 亭 堤）修正；取值见 `shared/types.ts` 的 `POI_CATEGORIES`。
5. 打分：`distance − (inView ? 25 : 0) − (local ? 10 : 0)`；`inView` = 有朝向且方位角与朝向相差 ≤ 30°。面状候选（湖泊、公园、区县）在范围内时 `area: true`、`distance: 0`，排在点状候选之后。
6. 逆地理：与第 2 步同一数据源，高德 `v3/geocode/regeo` 或 Nominatim `reverse`（`User-Agent: Living/1.0 (+https://living.ticoag.fun)`，`accept-language=zh-CN`），得到 `city`、`district`；直辖市的城市取省名。
7. KV 缓存 7 天：`poi:near:<provider>:<lat 4 位>:<lng 4 位>:<radius>`、`geo:rev:<provider>:<lat 3 位>:<lng 3 位>`。外部请求超时 8 秒；失败时 `provider: "local"`，只返回站内候选。
8. `privacyZone`：坐标落在请求者某个隐私区域内时返回区域名。

# GET /api/pois/search?q=&lat=&lng=（登录）

按名称搜索：站内 `name`/`aliases` 包含 `q` 且对请求者开放的地点（规则同上），加上高德 `v3/place/text`（有 Key 时）。返回 `{ "results": MatchCandidate[] }`，有坐标时附距离并按距离排序，最多 20 个。

# POST /api/pois（登录）

`NewPoi` → 201 `{ "poi": Poi }`。`source` 默认 `custom`；外部来源按 `(source, sourceId)` 去重返回已有地点；半径取 `CATEGORY_RADIUS`。

# PATCH /api/pois/:id（创建者或管理员）

`{ "name"?, "category"?, "radius"?, "aliases"? }` → `{ "poi": Poi }`。
