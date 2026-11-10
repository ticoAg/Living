---
type: D1 Table
title: privacy_zones
description: 隐私区域：用户自己设定的圆形区域（如家附近），落在其中的照片位置强制隐藏：新增区域时改写已有照片，之后上传的也一样。
tags: [data, d1, privacy]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0001_init.sql
    title: 迁移文件
---
# Schema

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键 | `pz_<ulid>` |
| `owner_id` | TEXT | 非空，外键 → `users.id`，删除时级联删除 | 所有者 |
| `name` | TEXT | 非空 | 名称，如"家" |
| `lat` | REAL | 非空 | 圆心纬度，WGS-84 |
| `lng` | REAL | 非空 | 圆心经度，WGS-84 |
| `radius` | REAL | 非空，默认 `300` | 半径（米）；接口限制在 50–5000 |
| `created_at` | TEXT | 非空，默认当前 UTC 时间 | 创建时间 |

索引：

- `privacy_zones_owner`（`owner_id`）：取某个用户的全部区域。

# 关系

- 属于 [users](/data/users.md)，用户删除时级联删除。
- 与 [photos](/data/photos.md) 没有外键：新增区域和上传时用坐标和区域做距离判断。
- 功能说明：[隐私](/product/features/privacy.md)、[地点匹配](/product/features/poi-matching.md)。接口：[用户与管理接口](/api/users-admin.md)。

# 规则

- 创建照片时，坐标落在本人任一区域内，`photos.geo_privacy` 强制为 `hidden`；`POST /api/pois/match` 同时返回区域名，上传页提示"在隐私区域「家」内"。
- 新增区域时，本人的已有照片中，自己的坐标（`photos.lat` `lng`）落在圆内且还不是 `hidden` 的，`geo_privacy` 一并改为 `hidden`，`updated_at` 更新；区域和这些改动在同一个批次里写入。只靠地点定位、没有自己坐标的照片不改。接口返回改了几张，设置页显示出来。
- 删除区域不恢复原来的位置精度：哪些照片原来是什么精度没有记录，需要时到照片编辑页逐张改回。

# 隐私

这张表存的是用户最敏感的位置（家、单位）。只有所有者能读写；匹配接口只返回区域的名称，不返回坐标；不要把它写进日志，也不要出现在任何公开接口里。
