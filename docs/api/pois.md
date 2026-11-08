---
type: API
title: 地点接口
description: 地点列表与详情、按坐标匹配候选、按名称搜索、新建与修改地点。
tags: [api, places]
---
# GET /api/pois

`{ "pois": Poi[] }`：至少有一张对请求者可见、且位置未隐藏的照片的地点，`count` 为这些照片数。参数 `owner=<handle>` 只统计该用户的照片。

# GET /api/pois/:id

`{ "poi": PoiDetail, "nearby": (Poi & { "distance": number })[] }`：附近 5 公里内、有可见照片的地点，按距离最多 8 个。`PoiDetail` 是 `Poi` 加上给编辑用的两项：

- `canEdit`：请求者能不能修改这个地点，即创建者、站长或管理员；未登录或没有权限时为 `false`。
- `aliases`：别名数组，只在 `canEdit` 为 `true` 时返回。

接口不返回创建者的用户 id。自建地点的坐标就是创建者拍照的位置，返回 id 会把一个人和这个位置联系起来，哪怕他的那张照片是隐藏的。

# POST /api/pois/match（登录）

请求 `MatchRequest` → `MatchResponse`。

1. 站内候选：`pois` 中距离 ≤ `max(radius, poi.radius)` 且对请求者开放的地点（别人的自建地点要有公开且位置未隐藏的照片在用，见 [pois 的隐私](/data/pois.md#隐私)）；`radius` 默认 300，最大 1000。
2. 外部候选：有 `AMAP_KEY` 且坐标在中国境内时调用高德 `v3/place/around`（坐标先转 GCJ-02，结果转回 WGS-84，按距离排序，最多 25 个）；否则 OpenStreetMap，经免费公共服务 Photon（`photon.komoot.io/reverse`）同时发两次请求，各取半径内最近的 50 个带名称的对象：一次不限类型（店铺、餐馆、建筑、车站……），一次只要 tourism、historic、leisure、natural、man_made=bridge/tower/pier、amenity=place_of_worship、waterway、place=square/island/village（`osm_tag` 过滤），免得景点被街边店铺挤出前 50。两次合并去重，有一次失败也照样返回；两次都失败时退到 Overpass。路牌、导览图、界碑和普通道路不列入。
3. 与站内候选去重：相同 `source + sourceId`，或同名且相距 < 80 米。
4. 类别：由高德类型或 OSM 标签映射（OSM 的店铺、酒店、车站、写字楼和有名字的建筑也有类别），再按名称后缀（桥 湖 山 寺 塔 岛 村 园 亭 堤）修正；取值见 `shared/types.ts` 的 `POI_CATEGORIES`。
5. 打分：`distance − (inView ? 25 : 0) − (local ? 10 : 0)`；`inView` = 有朝向且方位角与朝向相差 ≤ 30°。面状候选（湖泊、公园、区县）在范围内时 `area: true`、`distance: 0`，排在点状候选之后。
6. 逆地理：与第 2 步同一数据源，高德 `v3/geocode/regeo` 或 Nominatim `reverse`（`User-Agent: Living/1.0 (+https://living.ticoag.fun)`，`accept-language=zh-CN`），得到 `province`、`city`、`district`；直辖市的城市取省名。`province` 只来自逆地理，失败时为 `null`；`city`、`district` 失败时取最近的站内候选的。
   - Nominatim 的省份取 `state`（日本是 `province`），北京等直辖市按 ISO 代码命名；同一个名字给出简繁两种写法（`第七区;第七區`）时取第一个。
   - 中国大陆的地址字段不固定：区县可能在 `city`、`district` 或 `county`，乡镇、街道、苏木可能在 `city`，地级市在 `state_district`、`region` 或 `league`，也可能没有。区县取这些字段里第一个以区、县、旗结尾的，或已知地级市之下的县级市（义乌市、北流市）；城市取地级市；乡镇不会被当成城市。
   - 地址里没有直接写出地级市时（西湖区、义乌市都是这样），再以 zoom 7 请求一次 Nominatim，它返回的是地级市；比较两者分出县级市。第二次请求失败时整个逆地理算失败，不缓存只有一半的结果。
7. KV 缓存 7 天：`poi:near:<amap|photon>:<lat 4 位>:<lng 4 位>:<radius>`、`geo:rev2:<provider>:<lat 3 位>:<lng 3 位>`（每小时的省份补全也用这个缓存）。外部请求超时 8 秒；失败时 `provider: "local"`，只返回站内候选。
8. `privacyZone`：坐标落在请求者某个隐私区域内时返回区域名。

# GET /api/pois/search?q=&lat=&lng=（登录）

按名称搜索：站内 `name`/`aliases` 包含 `q` 且对请求者开放的地点（规则同上），加上外部结果。返回 `{ "results": MatchCandidate[] }`，有坐标时附距离并按距离排序，最多 30 个。

外部结果：

| 条件 | 来源 |
|---|---|
| 有 `AMAP_KEY`，有坐标且在中国境内 | 高德 `v3/place/around`，`keywords=q`，半径 6 千米 |
| 有 `AMAP_KEY`，没有坐标 | 高德 `v3/place/text` |
| 其余，有坐标 | Photon 搜索和 Nominatim 搜索，都限定在照片周围约 6 千米的框内（`bbox`、`viewbox` + `bounded=1`）；再加上 1 千米内附近地点里名称包含 `q` 的（按词搜索会漏掉中文名称的一部分，例如"咖啡"之于"库迪咖啡"） |
| 其余，没有坐标 | Photon 搜索和 Nominatim 搜索，不限范围 |

KV 缓存 1 天：`poi:q:<amap|osm>:<q>[:<lat 2 位>:<lng 2 位>]`，有坐标时按约 1 千米的网格分开。所有来源都失败时只返回站内结果。

# POST /api/pois（登录）

`NewPoi` → 201 `{ "poi": Poi }`。`source` 默认 `custom`；外部来源按 `(source, sourceId)` 去重返回已有地点；半径取 `CATEGORY_RADIUS`。

# PATCH /api/pois/:id（创建者或管理员）

`UpdatePoiBody`：`{ "name"?, "category"?, "radius"?, "aliases"? }` → `{ "poi": PoiDetail }`（`canEdit` 为 `true`，不含 `count`）。没写的字段保持原样。

| 字段 | 规则 |
|---|---|
| `name` | 1 到 80 个字符，去掉首尾空白 |
| `category` | `POI_CATEGORIES` 之一 |
| `radius` | 数字，10 到 5000（米） |
| `aliases` | 字符串数组，最多 20 个、每个最多 80 个字符，重复的合并；空数组清空。也可以传一个字符串，按 `,` `，` `;` `；` `、` 和换行拆开 |

错误：401 未登录；403 既不是创建者也不是站长、管理员；404 地点不存在；400 字段不合规，`message` 说明是哪一项。限值在 `shared/types.ts` 的 `POI_LIMITS`，[编辑页](/product/features/places.md#编辑) 用同一份在发送前检查。
