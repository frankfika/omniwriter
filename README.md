# OmniWriter · 多平台 AI 创作工作台

> **一句话、多个链接或一个 GitHub 仓库 → AI 写母稿 → 自动适配九个平台 → 一键复制 / 下载发布。**
> 中文写作、多平台排版的一体化工作台，面向创作者：公众号、X、知乎、小红书、B站、CSDN、Reddit、Hacker News、Product Hunt。

OmniWriter 是一套**开放**的创作 Agent：给它素材和你的立场，它按内置编辑准则与事实核查规则生成母稿，再按每个平台的形态、篇幅、钩子、证据要求逐稿改写，让你专注「判断」，把「搬运 / 排版 / 分发」交给 AI。

## 为什么是 OmniWriter

- **一稿多投，不是复制粘贴**：不是把同一篇机械地跨平台发，而是为每个平台重写钩子、长度、证据、CTA（X ≤240 字、HN 用 Show HN 文本帖、PH 用 Maker Comment 字段化…）。
- **AI 只负责执行，判断留给你**：论点、角度、立场由你给；模型遵循内嵌的编辑准则（论点先行、去 AI 味、真实图片作证、生态竞争落具体）。
- **开放**：模型走标准 Anthropic 兼容接口，默认连 MiniMax-M2.7，`.env.local` 换个 key 就能换成任意模型；数据纯本地，随时导出 HTML / ZIP 带走。

## 功能

- **统一创作入口**：首页只有一个输入框，支持正文、最多 8 个网页链接与 GitHub 仓库；自动识别任务并在提交后直接生成、进入编辑器。
- **GitHub 上下文**：公开仓库链接会读取 README；可与其他网页和用户说明合并为一份带来源分隔的素材。
- **能力与模板市场**：Agent 负责组织任务，11 套风格负责表达，7 套公众号模板负责成品外观；首页可直接进入模板市场。
- **Tiptap 编辑器**：中文友好的极简工具栏（标题 / 加粗 / 引用 / 列表 / 代码 / 图片）；粘贴或拖拽图片自动弹图注对话框（契合「图 N｜描述。图片来源：…」）；字数实时显示，自动保存到浏览器。
- **编辑准则校验条**：编辑区上方实时检查 h1 数量、图片编号、AI/营销标签词，按高 / 中 / 低分级。
- **公众号实时预览**：石墨风（纯白 / 近黑 / 软灰 / 无装饰），行内样式（公众号会剥离 `<style>`），移动端 / 桌面切换；一键复制正文（富文本 + 纯文本双格式）。
- **多平台适配**：九平台逐个改写，钩子 / 长度 / 证据 / CTA 各自重写。
- **ZIP 导出**：服务端构建 `article.html`（带复制按钮）+ 母稿 md + 图片目录，离线也可发布。
- **设置**：默认平台、双语、通用写作风格、公众号系列标题 / Eyebrow / 署名、新闻 Eyebrow。
- **文章存档**：localStorage 持久化，本地优先，断网可用。
- **离线恢复**：已访问的页面和静态资源由 Service Worker 缓存；服务短时不可达时仍可打开并编辑本地文章，恢复后自动提示。
- **洗稿（Rewriter）**：首页底部「洗稿」面板：贴一个推特 / 新闻 / GitHub 链接，自动抽取原文与原图，按目标平台（默认 X/Twitter，可切公众号 / 知乎 / 小红书）改写并保留图片；自带复制 + `twitter.com/intent/tweet` 一键发推。每次改写 / 生成都会跑一次第二模型交叉验证，给出通过/不通过、问题清单、改进建议；用户和兜底 key 都不在时退到本机 `codex` / `claude` CLI 委托验证。生成主模型失败时也会自动切到服务端兜底 key 重试一次，并把真实错误回显给用户。

## 快速开始

> 💡 最省事：双击 **`dev.command`**（或终端运行 **`./dev.sh`**）——自动补依赖、启动并打开浏览器。

1. 打开 `http://localhost:3000` → 右上角「设置」→「**AI 连接**」，粘贴你的 **API Key**（默认接 MiniMax 接口，Base URL / 模型可按需改）。密钥只存在你的浏览器本地，改完即生效，无需重启。
2. 回首页输入主题、正文或多个链接 → 点发送；系统自动选择合适写法、读取来源、生成母稿并进入编辑器。

> 也可以用 `.env.local` 的 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 作为**服务端兜底**（老方式，`pnpm dev` 即可）。

未配 key 也能用：编辑器、预览、平台稿、ZIP 导出都正常，只是 AI 生成不可用（界面会引导你在设置里填密钥）。

## 高可用容器部署

仓库内置了生产级多实例编排：两个无状态 OmniWriter 实例分别只暴露到宿主机 `127.0.0.1:3011` / `3012`。Compose 内置的 Nginx gateway 绑定 `127.0.0.1:3080`，可直接验证负载均衡与故障切换；正式域名也可继续使用宿主机 Nginx（配置模板见 `deploy/nginx.conf`）。

```bash
# 可选：复制并填写服务端 AI 兜底配置；也可以完全使用浏览器里的个人 AI 配置
cp .env.local.example .env.production

APP_VERSION=$(git rev-parse --short HEAD) \
  docker compose --env-file .env.production -f compose.ha.yaml up -d --build

curl --fail http://127.0.0.1:3011/api/health
curl --fail http://127.0.0.1:3012/api/health
curl --fail http://127.0.0.1:3080/api/health
docker compose -f compose.ha.yaml ps
```

后续版本使用顺序更新脚本，先更新 A 并等待健康，再更新 B；任一健康门禁失败会保留或恢复旧副本：

```bash
./scripts/deploy-ha.sh
```

本地或 CI 可运行完整故障切换回归。脚本会停启 A/B、在线重建两个实例，并持续通过 gateway 发请求；结束时自动恢复两实例：

```bash
pnpm verify:ha
```

- `/api/health` 返回版本与实例标识，可用于容器、负载均衡和外部监控的存活检查。
- `restart: unless-stopped` 自动恢复进程故障；宿主机 Nginx 会把失败请求切换到另一实例。
- 启用 `deploy/nginx.conf` 前先替换域名。生成接口最长可能运行数分钟，模板已关闭响应缓冲并保留 180 秒读取超时，SSE 进度可实时到达浏览器。
- 两个容器仍在同一台宿主机上，只解决进程 / 容器级故障。要覆盖主机和可用区故障，需要在第二台主机运行同一编排，再由云负载均衡做跨主机健康检查。
- 文章与个人 AI Key 当前保存在浏览器本地，服务端本身无会话状态，因此可以安全横向扩容；跨设备同步需要后续增加账号与云端存储。

### 生产发布（TCR + GitHub Actions）

生产环境使用独立的 `compose.production.yaml`：只拉取带 Git SHA 的不可变 TCR 镜像，不在服务器现场构建；容器启用只读文件系统、内存/PID 上限和日志轮转。`.github/workflows/deploy-production.yml` 仅允许手动触发，并通过 GitHub `production` Environment 审批后滚动更新 A/B；健康门禁或外部 smoke 失败会自动回滚旧镜像。

上线前需要配置 Repository Secrets：`TCR_REGISTRY`、`TCR_NAMESPACE`、`TCR_USERNAME`、`TCR_PASSWORD`、`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`，并把最终 HTTPS 地址保存为 Repository Variable `PRODUCTION_URL`。完整首次上线、Nginx/TLS、验证和回滚步骤见 [`deploy/PRODUCTION.md`](deploy/PRODUCTION.md)。

公网部署默认**不注入共享 AI Key**：每位用户在「设置 → AI 连接」保存自己的浏览器密钥，避免公开站点消耗服务器共享额度。如果站点已有访问认证，可把共享 Key 作为纯文本 secret file 放到 `secrets/anthropic_api_key`；应用通过 `ANTHROPIC_API_KEY_FILE` 读取，密钥不会写进镜像或 Compose 环境。

## 环境变量

> 可选的服务端兜底：日常使用在「设置 → AI 连接」填你的密钥即可，无需配置这里。

```bash
ANTHROPIC_API_KEY=...                # 必需：AI 模型的 key
ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key  # 生产推荐，与上面二选一
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic   # 默认：pen.dev 同款接口
ANTHROPIC_MODEL=MiniMax-M2.7         # 默认
FETCH_TIMEOUT_MS=15000               # 抓取新闻链接的超时
```

## 使用流程

1. 在首页的统一输入框说明目标，或粘贴正文、最多 8 个网页 / GitHub 链接；默认自动识别，也可手动选择新闻、GitHub 或观点模式。
2. 提交后自动读取来源并生成母稿；AI 未连接时才停在素材页等待配置，已连接则直接进入编辑器。
3. 「编辑」：在 Tiptap 微调中英文稿；可联网搜索并插入带来源、作者和许可的真实图片。
4. 「发布」：在成品预览中切换 7 套公众号模板，复制公众号富文本或保存完整长图。
5. 切到平台文案，逐项检查中英文 9/9 稿件，再复制到对应平台；失败项可单独重试。
6. 「导出 ZIP」拿到 `article.html`（带复制按钮）+ `article.md` + `images/`。

工作台在所有尺寸都使用「素材 → 生成 → 编辑 → 发布」单任务阶段，避免表单、编辑器、预览和平台稿同时挤在一屏；桌面保留文章侧栏，移动端改为紧凑顶栏。

## 技术栈

- **Next.js 14**（App Router）+ **TypeScript** + **Tailwind CSS**
- **Tiptap 2**（编辑器 + character-count + image + placeholder）
- **Zustand**（状态 + localStorage，含持久化防抖与失败兜底）
- **@anthropic-ai/sdk**（AI，服务端调用，默认 MiniMax-M2.7）
- **JSZip**（仅服务端 ZIP 打包，不进客户端 bundle）
- **lucide-react**（图标）

## 目录

```text
.
├── app/                  Next.js App Router（首页 / 工作台 / 设置 / api）
├── components/           UI 组件（AppShell / Editor / BriefPanel / PreviewPane / PlatformTabs / ui/*）
├── src/lib/              内置内容模块
│   ├── ai.ts             MiniMax-M2.7 客户端 + 提示词（含服务端兜底重试）
│   ├── editorial.ts      编辑准则 + 事实核查 + 石墨风 CSS + 校验
│   ├── platforms.ts      九平台规范
│   ├── styles.ts         11 套写作风格与提示词细则
│   ├── export-html.ts    HTML 构建 / 富文本复制（客户端安全）
│   ├── export-zip.ts     ZIP 打包（服务端）
│   ├── twitter.ts        推特/X 公开抓取（CDN syndication + fxtwitter 备胎）
│   ├── rewrite.ts        洗稿核心（推特 / 新闻 / GitHub → 目标平台新稿）
│   ├── rewrite-helpers.ts洗稿用纯函数（解析、裁剪、hashtag 切分）
│   ├── cross-validate.ts 第二模型 / Codex / Claude Code 交叉验证
│   ├── custom-agents.ts  自定义 Agent 持久化（市场扩展）
│   ├── store.ts          Zustand store + 持久化
│   └── config.ts         默认配置（用户配置在浏览器 localStorage）
├── tailwind.config.ts    设计令牌（石墨色 + 中文字体栈）
└── .env.local.example    环境变量模板
```

## 设计原则

- 石墨风：纯白 / 近黑 `#1d1d1f` / 软灰 `#f5f5f7`，无蓝色强调、无渐变、无玻璃感、无大圆角装饰。
- 16px 起、约 1.7 行高、中文字体栈（PingFang SC / Hiragino Sans GB / Microsoft YaHei），移动端输入框 16px 防 iOS 缩放。
- 文末主张句而非空泛总结；按钮动词开头；空白状态指明下一步。
- 开放优先：AI 接口可换、数据本地化、一稿多投。

## 路线图

- [ ] 文章导出为 GitHub repo（gh CLI 或 API）
- [ ] 同步设置到云端（账号）
- [ ] AI 改稿（「这段太 AI」→ 局部重写）
- [ ] 实时协作
- [x] 生成流式输出（SSE）、取消与平台批量进度
