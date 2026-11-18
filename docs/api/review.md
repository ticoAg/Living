---
type: API
title: 回顾接口
description: 登录者自己的档案按日历汇总：有内容的年份，以及一年的每一天、类型和字数、用得最多的地点和标签、项目和合集、收藏的照片。
tags: [api, review, entries, photos]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/worker/routes/review.ts
    title: 路由
  - resource: https://github.com/ticoAg/Living/blob/main/shared/days.ts
    title: 日期
  - resource: https://github.com/ticoAg/Living/blob/main/shared/types.ts
    title: 接口类型
---
功能说明见 [日历与年度回顾](/product/features/calendar.md)。

两个接口都需要登录，未登录返回 401。只汇总登录者自己的记录和照片，不管公开范围：记录算草稿和已完成的，不算已归档的（和 [档案](/product/features/archive.md) 默认的时间线相同）；照片只算有拍摄时间的。响应带 `Cache-Control: no-store`。

一天是本地日期：记录按 `occurredAt` 的日期，照片按 `takenAt` 的日期，都是当时当地的钟表时间，不换算时区。

# `GET /api/review`

有内容的年份，最近的在前，带各自的记录数和照片数（`ReviewYearsResponse`）：

```json
{ "years": [{ "year": 2026, "entries": 252, "photos": 3 }, { "year": 2025, "entries": 4, "photos": 120 }] }
```

# `GET /api/review/:year`

一年的汇总（`YearReview`）。`year` 不是四位数字时返回 400「年份的格式应为 YYYY」；没有内容的年份照样返回，各项为空。

```json
{
  "year": 2026,
  "days": [{ "day": "2026-05-02", "entries": 2, "photos": 2 }],
  "chars": 2077,
  "types": [{ "type": "practice", "count": 131 }],
  "places": [{ "id": "poi_…", "name": "断桥", "category": "桥", "city": "杭州市", "district": "西湖区", "photos": 3, "entries": 1 }],
  "placeCount": 1,
  "tags": [{ "id": "tg_…", "name": "蓝", "color": "#3F6E8F", "photos": 3, "entries": 0 }],
  "projects": [
    {
      "id": "pj_…", "title": "从零开始学书法", "type": "learning", "status": "active", "visibility": "public",
      "entries": 2, "days": 2, "milestones": [{ "id": "ms_…", "title": "临完第一页", "date": "2026-05-02" }]
    }
  ],
  "collections": [],
  "favorites": []
}
```

| 字段 | 内容 |
|---|---|
| `days` | 这一年有内容的每一天，按日期，各带记录数和照片数 |
| `chars` | 记录的标题和正文一共多少个字（字符数，Markdown 原文） |
| `types` | 每种类型的记录数，多的在前 |
| `places` | 照片和记录的地点，按两者之和从多到少，同样多的按名称；最多 10 个（`REVIEW_TOP`）。`placeCount` 是这一年一共用到几个地点 |
| `tags` | 照片和记录的直接标签，排法同地点，最多 10 个 |
| `projects` | 自己的项目里这一年写过记录的，或有里程碑在这一年的：`entries`、`days` 只算这一年的记录，`milestones` 是这一年的里程碑（按日期）；记录多的在前，同样多的按名称 |
| `collections` | 自己的合集，字段和 [合集列表](/api/themes.md) 相同：有日期的，日期和这一年有交集；没有日期的，在这一年建立 |
| `favorites` | 这一年拍的收藏照片，字段和照片列表相同，按拍摄时间，最多 24 张（`REVIEW_FAVORITES`） |

# 读取的行数

一年的汇总在一个 `db.batch` 里跑七条语句，再查一次合集。日期范围走 `entries_owner_occurred (owner_id, occurred_at)` 和 `photos_owner_taken (owner_id, taken_at)` 两个索引，只读这一年的行；项目按自己的项目逐个数这一年的记录。一年几千条记录、几万张照片时读几万行，D1 免费版每天 500 万行。年份列表读一遍自己全部的记录和照片。
