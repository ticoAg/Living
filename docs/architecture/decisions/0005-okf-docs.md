---
type: Decision
title: 文档采用 OKF 并随仓库维护
description: 产品、架构、数据、接口和运行手册写成 Open Knowledge Format v0.2 知识包，放在仓库 docs/ 里，与代码同评审。
tags: [decision, documentation]
status: stable
decided: 2026-11-08
---
# 背景

Living 由多名开发者与多个 AI 代理并行开发。产品规则、数据结构、接口约定和运行方法，需要一份各方都能读、能引用、随代码一起评审的单一事实来源。

读者既有人也有代理：代理需要先看目录再按需读细节，不能一次读完所有文字。

# 决定

文档作为 [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.2 知识包放在仓库的 `docs/` 目录：

- 每个文件讲一个概念，开头是 YAML frontmatter：`type` 必填，常用 `title`、`description`（一句话）、`tags`、`status`、`sources`。
- 每个目录有 `index.md` 列出内容（不带 frontmatter，只有根目录的带 `okf_version`）；根目录有 `log.md` 记录变更，最新的在前。
- 概念之间用以 `/` 开头的包内路径链接，相对 `docs/`，例如 `/data/photos.md`。
- 目录分为 `product/`、`architecture/`（含 `decisions/`）、`data/`、`api/`、`runbooks/`。
- 代码里的注释指向文档（迁移文件头、`shared/types.ts`），文档的 `sources` 指回代码文件。
- 文字用中文，表格优先，一个概念不写成长文。

维护规则：改迁移、类型或接口的同一个 PR 必须更新对应文档；新增或移动文件要同步所在目录的 `index.md` 和根目录的 `log.md`。

# 后果

- 文档与代码同库同评审，历史可追溯，纯文本可 `grep`，在 GitHub 上直接渲染，没有构建和托管成本。
- `type` 和 `tags` 让代理可以按类别筛选，例如所有 `D1 Table`、所有 `Decision`；`index.md` 提供渐进式的阅读入口。
- 需要纪律：表结构、接口和文档不同步就会误导读者；链接和 frontmatter 要靠脚本或评审检查。
- 没有渲染好的站点。需要时可以用任何能读 Markdown 和 frontmatter 的静态站点工具生成。
- 要跟随 OKF 的版本演进，格式变化时更新 `okf_version`。

# 备选

- **只有 README**：容易膨胀，难以局部引用，代理读取成本高。
- **GitHub Wiki、Notion、飞书**：脱离代码评审，版本与代码不同步，代理读取不方便。
- **静态站点生成器（Docusaurus、MkDocs、VitePress）**：渲染更好，但需要构建与托管，各家的 frontmatter 约定也不同。
- **只靠 OpenAPI 和 ER 图自动生成**：能覆盖接口和表，覆盖不了产品规则与决策；接口类型已经在 `shared/types.ts`。
- **只记 ADR（adr-tools、MADR）**：本包的决策记录借用了 MADR 的结构（背景、决定、后果、备选），但放在同一个知识包里，可以与其他概念互相链接。
