---
type: Runbook
title: 本地开发
description: 安装依赖、建本地 D1、写入站长邀请码，用 Vite+ 一条命令在本机跑起前端、Worker 和本地 D1、R2、KV；提交前钩子；单元测试、路由测试和浏览器冒烟测试怎么跑。
tags: [runbook, dev]
sources:
  - resource: https://github.com/ticoAg/Living/blob/main/package.json
    title: 脚本
  - resource: https://github.com/ticoAg/Living/blob/main/vite.config.ts
    title: Vite+ 配置
  - resource: https://github.com/ticoAg/Living/blob/main/wrangler.jsonc
    title: Wrangler 配置
  - resource: https://github.com/ticoAg/Living/blob/main/e2e/playwright.config.ts
    title: 冒烟测试配置
---
# 前提

- Node.js 22.18 以上或 24（`.node-version` 写的是 24），以及 npm。工具链是 [Vite+](/architecture/decisions/0006-vite-plus.md)，作为开发依赖装在项目里，不需要全局安装 `vp`。
- 不需要登录 Cloudflare。开发服务器用本机模拟的 D1、R2、KV，数据保存在 `.wrangler/state/`（已在 `.gitignore` 里），不会碰线上数据。

# 第一次启动

1. 安装依赖。安装完会顺带装好 Git 提交前钩子，见 [提交前检查](#提交前检查)：

   ```bash
   npm install
   ```

2. 建本地数据库，应用 `migrations/` 下的全部迁移，包括 [预置标签](/data/preset-tags.md)：

   ```bash
   npm run db:migrate:local
   ```

3. 写入站长邀请码。本地库里还没有用户，只有 `owner` 邀请码能注册，原因见 [决策：认证](/architecture/decisions/0004-auth.md)。`<code>` 本地随便取，例如 `openssl rand -hex 8` 的输出：

   ```bash
   npx wrangler d1 execute living --local --command "INSERT INTO invites (code, role, note) VALUES ('<code>','owner','bootstrap')"
   ```

4. 启动开发服务器，监听 5173。Cloudflare 的 Vite 插件在同一个进程里用 workerd 运行 `worker/index.ts`，页面、`/api`、`/media` 和本地 D1、R2、KV 都由它提供：

   ```bash
   npm run dev
   ```

5. 打开 <http://localhost:5173/register>，邀请码填第 3 步的 `<code>`。注册的第一个账号就是站长；之后在"设置"里生成普通邀请码，见 [站点管理](/product/features/admin.md)。

# 日常

| 做什么 | 怎么做 |
|---|---|
| 改前端 | 保存即热更新 |
| 改 Worker | 保存后开发服务器自动重载 Worker |
| 检查 | `npm run check`，即 `vp check`：格式、Oxlint（含类型感知规则、React Hooks 与无障碍规则）和类型检查一起跑，要求零告警 |
| 自动修复 | `npx vp check --fix`，格式化并应用能自动修复的 lint 规则 |
| 测试 | `npm test`，即 `vp test`（Vitest）；监听模式用 `npx vp test watch` |
| 路由测试 | `npm run test:routes`：接口在本地 D1、R2、KV 上跑，见 [路由测试](#路由测试) |
| 冒烟测试 | `npm run test:e2e`：构建后在浏览器里走一遍主要页面，见 [冒烟测试](#冒烟测试) |
| 完整构建 | `npm run build`，即 `vp check --no-fmt`、`vp test`、`vp build`，与线上构建命令相同 |
| 预览构建产物 | `npm run build` 后 `npx vp preview`，在 workerd 里运行构建出的 Worker |
| 新增迁移 | `npx wrangler d1 migrations create living <描述>`，写好后 `npm run db:migrate:local`，规则见 [部署](/runbooks/deploy.md) |
| 跑一次定时任务 | 开发服务器运行时 `curl "http://localhost:5173/cdn-cgi/handler/scheduled"`，补全本地照片的省份并清理过期的地点缓存，见 [定时任务](/architecture/cloudflare.md#定时任务) |

格式与 lint 的设置都在 `vite.config.ts` 的 `fmt` 和 `lint` 里：单引号、不加尾随逗号、行宽 140；CSS 保持一条规则一行，`docs/` 不格式化。Lint 在 Oxlint 默认插件之外开了 `react`（含 React Hooks）和 `jsx-a11y`：条件调用 Hook、`useEffect` / `useMemo` 缺依赖或依赖每次渲染都变是错误，`<img>` 缺 `alt`、列表缺 `key`、可点击的 `div` 没有键盘操作是告警；关掉的规则（全局的在 `lint.rules`，只对个别文件的在 `lint.overrides`）旁边写着原因。类型检查按就近的 `tsconfig.json` 进行：`worker/` 用 `worker/tsconfig.json`（Workers 类型），`e2e/` 用 `e2e/tsconfig.json`（Node 类型），其余用根目录的 `tsconfig.json`。

# 提交前检查

每次 `git commit` 前，钩子对**暂存的文件**跑一遍格式化和 lint：能自动修的（格式、可修复的 lint 规则）直接修好并重新暂存，修不了的错误（包括这些文件里的类型错误）拦下这次提交并打印出来。全量类型检查和测试不在钩子里跑，留给 PR 检查，所以提交只多几秒。

| 部分 | 位置 |
|---|---|
| 钩子脚本 | `.vite-hooks/pre-commit`，内容是 `vp staged` |
| 对暂存文件跑什么 | `vite.config.ts` 的 `staged`：`vp check --fix --no-error-on-unmatched-pattern`（`docs/`、CSS 这类不格式化的文件跳过，不报错） |
| 安装 | `package.json` 的 `prepare`，即 `scripts/install-hooks.mjs`，在 `npm install`、`npm ci` 之后自动执行 `vp config --no-agent`：生成 `.vite-hooks/_/`（已被忽略）并把本仓库的 `core.hooksPath` 指向它 |

安装这一步绝不让 `npm install` / `npm ci` 失败：设了 `CI` 时（GitHub Actions 和 Cloudflare Workers Builds 都会设）、目录里没有 `.git` 时（tarball、拷贝出来的目录）、设了 `VP_GIT_HOOKS=0` 时直接跳过，什么也不输出；`vp config` 自己出错（比如没装 git）时只打印一行提示。

```bash
npx vp hooks status        # 看钩子是否就位
npx vp hooks disable       # 在这个克隆里关掉，之后的 npm install 也不会再装回来
npx vp hooks enable        # 重新打开
VP_GIT_HOOKS=0 git commit  # 只跳过这一次
```

- 钩子要求 Node 22.22.1 以上（22 系列）或 24.11 以上、Git 2.32 以上，这是 `vp staged` 的要求。
- 用 git worktree 时，`core.hooksPath` 写在各工作树共用的配置里，值是相对路径 `.vite-hooks/_`，每个工作树找自己目录下的那份：哪个工作树执行过 `npm install`，哪个就有钩子，其余照常提交。

# 单元测试

纯逻辑有单元测试：坐标换算、标签树、输入校验、地点匹配、可见性与位置隐私等。测试文件与源码放在一起，命名为 `*.test.ts`，范围见 `vite.config.ts` 的 `test.include`：

```bash
npm test                 # 跑一遍
npx vp test watch        # 监听模式，改动后自动重跑
npx vp test shared/geo   # 只跑路径里含 shared/geo 的测试文件
```

- 测试在 Node 里运行，不需要先构建或启动开发服务器：`mode` 为 `test` 时 `vite.config.ts` 不加载 Cloudflare 插件。
- 不碰真实的 D1、R2、KV 和外部服务。`worker/test-utils.ts` 提供内存里的 D1、KV 替身（`fakePlaceCache()` 替地点缓存表应答），`fetch` 在测试里用 `vi.stubGlobal` 替换。
- 涉及日期的测试用本地日期字段构造（如 `new Date(2026, 10, 8)`），结果不随机器时区变化。
- `npm run build` 会先跑检查和测试，有一项失败就不会构建。

# 路由测试

接口的集成测试：`worker/routes/*.routes.test.ts` 通过 `app.request()` 调用真实的路由，SQL 在本地 D1 上执行，文件写进本地 R2，会话和限流计数在本地 KV，`/media` 用本地的 Cache API。覆盖可见性与位置精度矩阵、账号、上传、照片、主题、标签、地点、隐私区域、邀请码和注册设置。

```bash
npm run test:routes                          # 跑一遍，即 vp test --mode routes
npm run test:routes -- worker/routes/tags    # 只跑一个文件
```

- 底座在 `worker/test-platform.ts`：每个测试文件用 Miniflare 启动一个 workerd，D1、R2、KV 都在内存里，不落盘；建库时按文件名顺序应用 `migrations/` 的全部迁移。每个测试开始前恢复到刚迁移完的状态（预置标签和设置还在，其余清空），只读的夹具文件（`visibility.routes.test.ts`）例外。
- 路由在 Node 里运行。D1 的语句由 workerd 里的一个小 Worker 在真实的 D1 绑定上执行，每次执行一个来回；KV、R2 和 Cache API 用 Miniflare 的绑定代理。
- 请求由 `Client` 发出：手动带上会话 Cookie（它是 `Secure` 的），写请求带站点的 `Origin`，并带固定的 `CF-Connecting-IP`（登录限流按它计数）；每个请求等 `waitUntil` 里的工作做完再返回。`ASSETS` 是返回一个空页面的替身。
- 不访问网络：对 Photon、Nominatim、Overpass、高德的请求由 `platform.external.respond` 应答（默认都返回 503，即外部服务不可用），访问其他外部主机会让测试失败；底座与 workerd 之间的本机通信不受影响。
- `newUser()` 直接在 D1 和 KV 里建用户和会话，`upload()` 走真实的上传接口，尺寸图只是魔数正确的几个字节。注册流程本身在 `auth.routes.test.ts` 里测。
- 期望按 `docs/api/` 写。暴露出、但还没有修的与文档不一致之处写成 `it.fails`，修好后改回 `it`。
- 不在 `npm test` 和 `npm run build` 里：线上构建在 Workers Builds 里执行 `npm run build`，那里能否启动 workerd 没有验证过。PR 检查单独跑它，见 [构建与发布](/architecture/ci-cd.md#pr-检查)。

# 冒烟测试

在真实浏览器（Playwright 的 Chromium）里对**构建产物**走一遍主要流程，代替上传、主题编辑、切页这些手工回归。一条命令：

```bash
npm run test:e2e                 # vp build，然后 playwright test --config e2e
npx playwright install chromium  # 第一次跑之前装浏览器（只需一次）
```

`playwright test` 先执行 `node e2e/state.ts` 重建测试专用的本地库，再起 `vp preview`（端口 4281，`E2E_PORT` 可改），跑完由 Playwright 关掉服务器，不留进程。端口被占用时直接失败，不会拿别的服务器上的数据去测。报告和失败时的截图、trace 在 `.wrangler/e2e/`（`npx playwright show-report .wrangler/e2e/report`）。

| 文件 | 内容 |
|---|---|
| `e2e/story.spec.ts` | 一个连续的故事：用站长邀请码注册 → 上传 3 张样例图并全部发布（检查 EXIF 的位置、朝向、拍摄时间入了库）→ 给照片关联地点 → 依次打开图库、照片页、地点页、地图、索引、主题列表、新建一个公开旅程、游记（主题阅读页）、Living、设置、标签管理、编辑照片并保存 |
| `e2e/regressions.spec.ts` | 修过的问题：页面分块返回 HTML 时自动重新加载、一直失败时停在「页面没能加载」和刷新按钮；会话过期后保存弹出重新登录、登录后再保存成功且已填内容还在；图库首行是 `/api/photos` 里最新的几张（桌面和手机宽度）；手机宽度（390×844）下图库、地图、标签管理没有横向溢出，底部导航栏滚动时一直贴在屏幕底部 |
| `e2e/support.ts` | 公共部分：拦掉外部请求、收集控制台错误和未捕获异常（每个用例结束时必须为空，故意制造错误的用例单独声明）、跟随链接、溢出检查 |
| `e2e/playwright.config.ts` | 两个项目：`story` 先跑并把登录态存到 `.wrangler/e2e/owner.json`，`regressions` 依赖它、用这份登录态 |

- **不碰开发数据**：`vite.config.ts` 读环境变量 `LIVING_STATE_DIR`，设了就把 Cloudflare 插件的 `persistState` 指到那里。冒烟测试用 `.wrangler/e2e-state/`，每次跑之前删掉重建：`wrangler d1 migrations apply living --local --persist-to .wrangler/e2e-state` 应用 `migrations/` 的全部迁移，再写入站长邀请码 `E2EOWNER01`。`npm run dev` 用的 `.wrangler/state/` 不变。
- **相机是假的**：浏览器带 `--use-fake-device-for-media-stream` 和 `--use-fake-ui-for-media-stream` 启动，页面内相机拿到的是一段生成的画面，是否允许使用相机自动答「是」（Playwright 默认用的无头版 Chromium 不带后一个参数就拒绝相机）。手机定位用 Playwright 的 `geolocation` 设定。「相机打不开」的用例把 `getUserMedia` 换成拒绝。
- **不依赖网络**：浏览器里所有发往外部的请求都由 `page.route` 应答，OpenFreeMap 的样式换成只有底色的空样式，地图不请求瓦片。地点匹配是 Worker 去请求 Photon、Nominatim（或高德），浏览器拦不到；用例不依赖匹配结果，地点用接口直接建好再关联。断网时这些请求立刻失败、接口照样返回站内候选，整套不比联网时慢（实测离线约 30 秒、联网约 38 秒，都含构建）。如果网络是「丢包不回应」那种，Worker 每次要等满 8 秒超时，所以测试给 `/api/pois/match` 设了 4 秒的上限，超时就按离线时的结果（没有候选）回给页面。
- **样例图**：`e2e/fixtures/` 下 3 张 900×600 / 600×900 的 JPEG，每张十几 KB，是用 Python 的 PIL 画的风景色块、用 piexif 写入 EXIF：GPS 在杭州断桥附近（30.259°N, 120.148°E）、`GPSImgDirection` 朝向 75°/120°/300°、拍摄时间 2026-05-02 06:41、2026-05-02 17:12、2026-05-03 19:05（+08:00）、相机 FUJIFILM X-T5。生成脚本不在仓库里；要换图，保证 EXIF 能被 `exifr` 读出这几项即可。
- **浏览器**：默认用 Playwright 自己下载的 Chromium（版本跟着 lockfile 里的 `@playwright/test`）。机器上已经有 Chromium 时，设 `E2E_CHROMIUM=<可执行文件路径>` 改用它，不必再下载。只想跑一部分：`npx playwright test --config e2e -g 会话过期`（先 `npx vp build`）。
- 跟随站内链接时先把指针移上去停一下再点（`follow()`），和用鼠标的人一样：悬停会预取页面分块和数据。
- 不在 `npm run build` 里：PR 检查有单独的 job 跑它，见 [构建与发布](/architecture/ci-cd.md#pr-检查)。

# 重置本地数据

删除 `.wrangler/state/` 会清空本地的 D1、R2 和 KV，然后重做第 2、3 步：

```bash
rm -rf .wrangler/state
npm run db:migrate:local
```

# 可选：使用高德

本地默认用 OpenStreetMap 匹配地点。要用高德，在仓库根目录建 `.dev.vars`（已被 `.gitignore` 忽略）：

```
AMAP_KEY=你的高德 Web 服务 Key
```

重启 `npm run dev` 生效。Key 的申请见 [密钥与初始化](/runbooks/secrets.md)。

# 常见问题

| 现象 | 原因与处理 |
|---|---|
| `npm install` 或 `vp` 提示 Node 版本不支持 | Vite+ 需要 Node `^22.18.0`、`^24.11.0` 或 26 以上，换成 `.node-version` 里的 24 |
| 注册提示邀请码无效 | 邀请码没写进本地库，或写进了线上库（命令里要带 `--local`）；用 `npx wrangler d1 execute living --local --command "SELECT code, role, used_at FROM invites"` 查看 |
| 登录后马上回到未登录 | 用 `http://localhost:5173` 访问，不要用局域网 IP：会话 Cookie 带 `Secure`，浏览器只对 `localhost` 这样的可信来源在 http 下保存它 |
| `/api` 报表不存在 | 本地库还没迁移，执行 `npm run db:migrate:local` |
| `npm run build` 停在检查或测试 | 先修 `npm run check` 和 `npm test` 报的问题；只是格式问题用 `npx vp check --fix` |
| 地点匹配没有候选 | 本地要访问外部服务：OpenStreetMap 的 Overpass 和 Nominatim，或高德；离线时只有站内地点 |
