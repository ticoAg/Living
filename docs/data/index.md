# 总览

* [数据模型总览](overview.md) - 数据分布在 D1、R2、KV 三处；表间外键、取值约定和删除时的级联规则

# D1 表

* [users](users.md) - 账号：用户名、显示名、角色和密码哈希
* [invites](invites.md) - 邀请码：角色、备注、使用者和有效期；站长引导邀请码也存在这里
* [tags](tags.md) - 多层级标签树：系统预置标签和用户自己的标签
* [pois](pois.md) - 地点：名称、类别、中心点和匹配半径，全站共享
* [photos](photos.md) - 照片：位置、拍摄参数、文件键、尺寸图信息、可见性和位置精度
* [photo_tags](photo-tags.md) - 照片与标签的多对多关联，记录标签来源
* [themes](themes.md) - 合集：一次旅程或一个专题的标题、导语、封面、日期范围和公开范围
* [theme_items](theme-items.md) - 合集的有序条目：照片、记录、文字段落或日期分段
* [entries](entries.md) - 记录：发生时间、Markdown 正文、类型、状态和公开范围，可以只有文字
* [entry_media](entry-media.md) - 记录与照片的多对多关联，带顺序和记录内的说明
* [entry_tags](entry-tags.md) - 记录与标签的多对多关联，与照片共用标签树但分开挂
* [projects](projects.md) - 项目：一个持续的过程，有类型、起止日期、状态和公开范围
* [entry_projects](entry-projects.md) - 记录与项目的多对多关联，只能放进作者自己的项目
* [milestones](milestones.md) - 项目的里程碑：到达或计划的日子，带这一阶段的总结
* [privacy_zones](privacy-zones.md) - 隐私区域：落在其中的照片上传时强制隐藏位置
* [settings](settings.md) - 站点级键值设置，目前只有注册方式
* [place_cache](place-cache.md) - 地点数据源的应答缓存：周边地点、名称搜索和逆地理，带过期时间，每小时清理

# 演进

* [数据演进](evolution.md) - 走向以记录为中心的数据计划：各阶段的表、主题如何成为合集、照片的默认可见性和迁移规则

# KV 与 R2

* [KV 会话与限流](kv.md) - 登录会话和登录限流计数；KV 的写入额度只留给登录
* [R2 媒体文件](media.md) - 原图与三种尺寸图的对象键、访问规则和生命周期

# 参考数据

* [预置标签](preset-tags.md) - 系统预置的 45 个标签及其 id
