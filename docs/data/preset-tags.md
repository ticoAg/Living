---
type: Reference Data
title: 预置标签
description: 系统预置的 45 个标签（题材、光与天气、季节、色调）及其 id，由迁移 0002 写入 tags 表。
tags: [data, tags, reference]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/migrations/0002_preset_tags.sql
    title: 迁移文件
---
# 标签树

预置标签的 `owner_id` 为空，所有人可见。每个节点写成"名称 `id`"：

* 题材 `subject`
  * 自然 `nature`：湖 `lake`、山 `mountain`、海 `sea`、河 `river`、树 `tree`、花 `flower`
  * 城市 `city`：街头 `street`、建筑 `architecture`、夜景 `nightscape`
  * 人文 `culture`：桥 `bridge`、塔 `pagoda`、寺 `temple`、展馆 `museum`
  * 生活 `life`：室内 `indoor`、美食 `food`、茶 `tea`、人 `people`、宠物 `pet`
* 光与天气 `light`
  * 光线 `lighting`：晨光 `morning`、白昼 `daylight`、日落 `sunset`、蓝调 `bluehour`、夜 `night`
  * 天气 `weather`：雾 `fog`、雨 `rain`、雪 `snow`
* 季节 `season`：春 `spring`、夏 `summer`、秋 `autumn`、冬 `winter`
* 色调 `tone`：暖 `warm`、冷 `cool`、绿 `green`、蓝 `blue`、黑白 `mono`

共 4 个根、41 个子孙节点。

# 色调的颜色

只有色调下的标签带 `color`，在界面里显示为色块：

| id | 名称 | `color` |
|---|---|---|
| `warm` | 暖 | `#C9925E` |
| `cool` | 冷 | `#8FA3B2` |
| `green` | 绿 | `#7D9A6B` |
| `blue` | 蓝 | `#4A7BA6` |
| `mono` | 黑白 | `mono`（黑白色块，不是十六进制色值） |

# 排序

四个根依次是 题材 10、光与天气 20、季节 30、色调 40。同一父节点下的 `sort` 按上面列出的顺序以 10、20、30… 递增。

# 自动建议用到的 id

上传时的标签建议（见 [多层级标签](/product/features/hierarchical-tags.md)）依赖这些 id：

| 依据 | 建议的标签 id |
|---|---|
| 地点类别 | 桥→`bridge`，湖→`lake`，山→`mountain`，寺→`temple`，塔→`pagoda`，海岸或岛→`sea`，街区→`street`，建筑或美术馆→`architecture` |
| 拍摄时刻与太阳高度 | `morning` `daylight` `sunset` `bluehour` `night` |
| 日期与南北半球 | `spring` `summer` `autumn` `winter` |
| 主色 | `warm` `cool` `green` `blue` `mono` |

# 规则

- id 是稳定标识：接口、链接（`?tags=lake,autumn`）和 Living 参数（`tags=lake`）都用它。不要改 id；只想改显示名时，在新的迁移里 `UPDATE tags SET name = …`。
- 迁移文件只增不改。增加预置标签要新建迁移，用 `INSERT OR IGNORE`，id 取没用过的英文单词。
- 用户标签的 id 是 `t_<ulid>`，不会与预置 id 冲突。
- 预置标签只有站长和管理员能通过接口修改。
- 表结构见 [tags](/data/tags.md)；接口见 [标签接口](/api/tags.md)。
