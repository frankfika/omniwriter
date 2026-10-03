# OmniWriter 优化实施方案（第一轮）

> 核对文件时发现一个问题，review 和勘误都没有提到：`verify` 事件只比 `done` 早一点到达（`app/api/generate/stream/route.ts:128-137`）。但 `app/article/[id]/page.tsx:473` 只等 500ms，`:492` 就把 `generationProgress` 设成 null，所以交叉验证结果在屏幕上只显示约 0.5 秒。把核查结果移到"完成后摘要"不只是换个位置，也顺带修好了这个问题。
>
> 另外，`components/Editor.tsx` 有你还没提交的改动，所以没有任何工作包会碰它。11 个测试文件只测 `src/lib/*` 和 SSE 解析（`tests/streaming-request-id.test.ts`），没有一个导入 components 或 route。本方案不改任何 `src/lib` 的导出 API，**预计不会影响任何测试**。

## 0. 设计原则

1. **只改位置，不删能力**：Agent、风格、模板选择、改写器、交叉验证、模板切换、导出 ZIP 都保留，只是收起来、挪位置或推迟出现。`src/lib/**` 的导出签名和组件 props 签名一律不变（`GenerationProgress` 的 4 个 props 还被 `BriefPanel`、`AgentCompose` 用着）。
2. **视觉配方统一，各包在自己的文件里落地**：
   - 页面底色：`app-workspace-bg`（WP4 把它改成纯色 `#fafafa`）。
   - 卡片：`bg-white border border-ink-line rounded-xl`。
   - 禁用：`backdrop-blur-*`、`bg-white/NN` 半透明白、彩色阴影 `shadow-[...rgba(79,70,229|99,102,241...)]`、所有渐变（包括 `bg-clip-text` 渐变字）。
   - 浮层（菜单/弹层）只允许用 `shadow-sm`。
3. **颜色**：
   - 主操作用 `bg-ink text-white`，次操作用 `border border-ink-line bg-white`，选中态用 `bg-ink-panel text-ink`。
   - indigo 只留给 `focus-visible:ring`。
   - emerald / amber / red 只用来表示状态。
4. **字号只留 4 档**：`text-xs` 辅助文字 / `text-sm` 界面正文 / `text-base` 输入与阅读 / `text-xl` 到 `text-3xl` 仅用于页面标题。
   - 统一替换：`text-[10px]`、`text-[11px]` 改成 `text-xs`；`text-[13px]` 改成 `text-sm`。
   - `globals.css` 里 prose 和预览渲染用的像素字号不算在内。
5. **落盘语义不变**：生成完成后仍然一次性写入编辑器，"边生成边写入"留到二期。

## 1. 工作包拆分（并行施工，文件范围互斥）

### WP1：首页极简
- **目标**：解决"三个区块抢入口、选择器太多"的问题。首页只留一句标题、一个输入框、提交按钮和示例。
- **文件清单（独占写）**：`app/page.tsx`、`components/QuickComposer.tsx`、`components/AppShell.tsx`
- **具体改动**：
  - `app/page.tsx`
    1. 删掉 `onBlank` 函数、"打开空白编辑器"按钮，以及因此不再用到的 `PenLine`、`loadConfig`、`Brief`、`useRouter`、`create` 引用。
    2. AI 状态胶囊（44-48 行）只在 `aiReady === false` 时显示，内容为"需要连接 AI · 去设置"。已连接和检测中时都不显示。
    3. H1 删掉 `<span className="block bg-gradient-to-r ...">` 的渐变，改成纯 `text-ink`。字号从 `text-[34px] sm:text-[46px]` 改成 `text-2xl sm:text-3xl font-semibold`。删掉 H1 下面那段说明 `<p>`。
    4. RewriterLauncher 那个 section 改成原生 `<details className="mt-6">`，`<summary>` 写"改写一段已有文案"（`text-sm text-ink-muted`，可点）。默认收起，组件本身不动。
    5. "最近内容" section 加 `xl:hidden`（桌面端侧边栏已经有列表）。改成纯文字列表：取前 5 条，每行标题加相对时间，`text-sm`。去掉图标方块和卡片背景，空状态那块直接删。
  - `components/QuickComposer.tsx`
    1. 新增 `const [advancedOpen, setAdvancedOpen] = useState(false)`。底栏左侧默认只显示一个 `SlidersHorizontal` 图标按钮，aria-label 为"高级选项"。如果用户已经手动选过 Agent、风格或模板，图标右上角加一个 `size-1.5 bg-ink` 小点。点击后在输入框和底栏之间展开一行，里面就是现有的三个下拉，菜单代码原样保留，只是挪个位置。
    2. `EXAMPLES` 换成 5 条短句，覆盖贴链接、只写标题、贴笔记、GitHub 发全平台、只排版这几种输入。删掉示例下方"最多读取 8 个链接 / 自动读取 GitHub README"那两行说明。
    3. 视觉调整：外框换成卡片配方（`rounded-2xl`，去掉 blur 和彩色阴影）；提交按钮改成 `bg-ink`；菜单浮层改成 `bg-white border-ink-line shadow-sm`；选中项从 `bg-indigo-50 text-indigo-700` 改成 `bg-ink-panel text-ink`；字号按原则 4 收敛。
  - `components/AppShell.tsx`
    1. 删掉 `AI STUDIO` 那个 span。
    2. 侧边栏去掉 `articles.slice(0, 8)`，直接列出全部文章（`nav` 本身已经能滚动）。删掉"还有 N 篇，在首页查看"链接和 `visibleArticles` 变量。
    3. aside 改成 `bg-white border-r border-ink-line`，去掉 blur 和阴影。Logo 方块改成 `bg-ink`。激活项从 inset indigo 阴影改成 `bg-ink-panel font-medium`。移动端顶栏也去掉 blur。
    4. 删除按钮的显隐类追加 `lg:group-focus-within:opacity-100`，让键盘用户也能看到。
- **不做**：不改 `RewriterLauncher.tsx` 内部；不改移动端顶部导航的结构；不改 `submit()` 的逻辑；不加左滑删除；不动 `?write=1` 的路由处理。
- **验收标准**：
  - 首页首屏只有：标题、输入框（底栏只有一个高级图标和提交按钮）、5 个示例 chip，以及一行"改写一段已有文案"。
  - 展开高级选项后，三个下拉都能用，选中结果会进入 brief。
  - 这三个文件里 `grep -E "backdrop-blur|bg-gradient|text-\[1[013]px\]|AI STUDIO"` 结果为 0。
  - tsc 通过。

### WP2：生成进度简化 + 交叉验证后置
- **目标**：解决"四步进度和验证面板制造等待焦虑"的问题，同时让验证结果在完成后真正能看到。
- **文件清单（独占写）**：`components/GenerationProgress.tsx`、`app/article/[id]/page.tsx`、`app/api/generate/stream/route.ts`
- **具体改动**：
  - `components/GenerationProgress.tsx`（props 签名不变）
    1. 删掉：两个 blur 光斑 div、四步 `<ol>`、`labels`、`STAGE_INDEX`、整个 verdict 区块，以及 `ShieldCheck`、`Check`、`cn` 等不再用到的引用。
    2. 第一行：脉冲小点、`stageCopy.title`、耗时、"已写 N 字"，右侧是"停止"按钮。不再显示 `stageCopy.detail`。
    3. 第二行：一条 2px 高的进度条，`bg-ink`，宽度由一个常量表决定：`{source:8, rules:15, waiting:25, streaming:60, translating:75, checking:90, done:100}`，加 `transition-[width]`。这只是阶段进度，不冒充百分比。
    4. 主体是实时流面板：`max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-soft`，内容为 `state.preview`。用一个 ref 加 `useEffect([state.preview])` 自动滚到底部。没有内容时显示一行"等待第一段正文…"。
    5. 底部说明压成一行 `text-xs`："完成后自动进入编辑器，停止不会覆盖已有内容。"
    6. 容器改成卡片配方。
  - `app/api/generate/stream/route.ts`：第 101 和 117 行的 `preview` 从 `slice(-180).replace(/\s+/g,' ').trim()` 改成 `slice(-1500)`，保留换行，让流面板能读出段落。事件形状不变。
  - `app/article/[id]/page.tsx`
    1. 新增 `const [verdict, setVerdict] = useState<CrossValidationVerdict | null>(null)`，类型从 `@/src/lib/generation-events` 引入。
    2. 在生成函数开头（`setGenerating(true)` 那里，约 359 行）调用 `setVerdict(null)`。`applyEvent` 的 `'verify'` 分支（约 427 行）里额外调用 `setVerdict(event.verdict)`。
    3. 在 `editorPanel` 标题行（约 866 行"排版预览"按钮前）加一个原生 `<details className="relative">` 摘要：
       - 通过时：summary 显示 `ShieldCheck` 加"已通过 AI 核查"，`text-xs text-ink-muted`。
       - 未通过时：显示"AI 核查：{issues.length} 条建议"，`text-amber-700`。
       - 展开后是一个 `absolute` 浮层（白底、细边框、`shadow-sm`、`w-72`），列出 model、score、issues 和 suggestions。
       - 用 `key={article.id}` 保证切换文章时重置。
    4. 第 1043 行容器从 `max-w-xl` 改成 `max-w-2xl`，给流面板留出阅读宽度。
    5. 本文件内顺手按原则 2 到 4 清理：顶栏（998 行）、批量进度条（1034 行）、三个面板容器（1049、1054、1059 行）的 blur、彩色阴影、indigo 色和 `text-[10px]/[11px]`。
- **不做**：不把流式内容写进编辑器；不改 `generation-events.ts` 的类型；不改 `cross-validate.ts`；不把 verdict 持久化到 Article（那样会动 `types` 和 `store`，还会牵连 backup 测试）；不改 `verify` 先于 `done` 的发送顺序；不动"成品预览 / 平台文案"这一级 tab。
- **验收标准**：
  - 生成时只看到：一行状态、一条细进度条、一个可滚动且带段落的实时正文面板。
  - 生成完成进入编辑器后，标题行能看到核查摘要，并且一直保留（刷新后消失是预期行为）。
  - `BriefPanel` 和 `AgentCompose` 不用改就能通过编译。
  - `tests/streaming-request-id.test.ts` 通过。

### WP3：平台稿页简化
- **目标**：去掉"预览 / 编辑"二选一，让用户打开就是可以直接复制的状态，复制是主操作。
- **文件清单（独占写）**：`components/PlatformTabs.tsx`、`components/PreviewPane.tsx`
- **具体改动**：
  - `PlatformTabs.tsx` 里的 `PlatformBody`
    1. 删掉整个 `role="tablist"` 块（242-276 行，包括键盘处理和 `copyModeLabel` 那个 span），连同 `copyModeLabel` 函数和 `Eye` 引用一起删。
    2. 纯文本或 Markdown 平台（`spec.copyMode !== 'rich'`）：只显示 textarea，文本本身就是成品，不需要预览。
    3. 富文本平台（`spec.copyMode === 'rich'`）：默认显示渲染后的成品。在 spec 信息行右侧加一个文字按钮"编辑"，点击后切到 textarea，按钮文字变成"完成"。原来的 `viewMode` state 改名为 `editing: boolean`。
    4. 底部操作行：复制按钮改成 `variant="primary"` 并放到最左；"重新适配"改成 `variant="ghost"`。
  - `PlatformTabs.tsx` 里的 `PlatformTabs`
    1. tab 上的"已完成"圆点从 `bg-indigo-500` 改成 `bg-emerald-500`。
    2. 底栏"生成全部 / 生成其余"按钮保持 primary；当 `remainingCount === 0` 时改成 `variant="ghost"` 并显示"全部重新生成"。
    3. 空状态的图标底色从 indigo 改成 `bg-ink-panel text-ink-muted`。
  - `PreviewPane.tsx`
    1. 删掉手机宽度 / 桌面宽度切换（`SegBtn` 组件、`width` state、`Smartphone`、`Monitor` 引用），预览框固定为 `max-w-[390px]`，截图宽度也因此固定。
    2. "保存截图"改成 `variant="ghost"`，只显示图标，aria-label 为"保存长图"。
  - 两个文件都按原则 4 收敛字号，模板浮层里的 `text-[10px]` 也改成 `text-xs`。
- **不做**：不做 contentEditable 富文本编辑；不改 `onCopy`、`placeImagesInHtml`、`sanitizePlatformPreview` 的逻辑；不动配图卡片区；props 签名不变；不改文章页里"成品预览 / 平台文案"那一级 tab（属于 WP2 的文件）。
- **验收标准**：
  - 小红书、X 这类纯文本平台打开就是可编辑的文本框。
  - 公众号这类富文本平台打开就是成品，点"编辑"可以改，点"完成"回到成品。
  - 复制按钮是唯一的实心按钮。
  - 两个文件里 `grep -E "role=\"tablist\"|SegBtn|text-\[1[013]px\]"` 结果为 0。
  - tsc 通过，`tests/export-html.test.ts` 通过（只调用不修改）。

### WP4：视觉体系收敛（tokens 和其余组件）
- **目标**：解决"玻璃拟态太重、三套按钮配色、字号过碎"的问题，把它们收成一套。
- **文件清单（独占写）**：
  - 全局：`app/globals.css`、`tailwind.config.ts`、`components/ui/button.tsx`、`components/ui/tabs.tsx`
  - 页面：`app/marketplace/page.tsx`、`app/settings/page.tsx`
  - 组件：`components/BriefPanel.tsx`、`components/AgentCompose.tsx`、`components/CreativeCopilot.tsx`、`components/RewriterLauncher.tsx`、`components/ValidationStrip.tsx`、`components/ErrorBanner.tsx`、`components/LanguageTabs.tsx`、`components/ImageSearchPanel.tsx`、`components/AgentConfigDialog.tsx`、`components/AgentStudio.tsx`、`components/AiSetupGuide.tsx`、`components/AvailabilityStatus.tsx`
- **具体改动**：
  1. `globals.css`：
     - `.app-workspace-bg` 只保留 `background-color: #fafafa`，删掉两层 radial 和网格线。类名不变，这样各处引用都不用改。
     - 先 `grep` 确认 `--app-accent`、`--app-accent-soft` 没有被引用，然后删掉。
  2. `tailwind.config.ts`：`accent.DEFAULT` 保持 `#1d1d1f`，不新增 token。规则写在原则里，不再加一层配置。
  3. `ui/button.tsx`：
     - `primary` 改成 `bg-ink text-white hover:bg-ink-soft`，去掉渐变和阴影。
     - `secondary` 改成 `bg-ink-panel text-ink hover:bg-ink-line/60`。
     - `outline` 改成 `border border-ink-line bg-white text-ink hover:bg-ink-panel`。
     - focus ring 保留 indigo。
  4. `ui/tabs.tsx`：选中态里如果有 indigo，改成 ink 下划线或 `bg-ink-panel`。
  5. 文件清单里的其余组件做机械替换，按原则 2 到 4：
     - `text-[10px]`、`text-[11px]` 改成 `text-xs`，`text-[13px]` 改成 `text-sm`。
     - 删掉 `backdrop-blur-*`。
     - `bg-white/NN` 改成 `bg-white`。
     - 彩色阴影删掉，浮层改成 `shadow-sm`。
     - `from-slate-900 to-indigo-*` 渐变改成 `bg-ink`。
     - 非状态用途的 `indigo-*` 改成 ink 或 ink-panel 系。
- **不做**：不碰 `components/Editor.tsx`（有未提交改动）；不碰 WP1 到 WP3 的文件；不改任何组件结构、文案和交互；不动 `.prose-app`、`.wechat-preview`、`.platform-rendered` 这些发布排版样式，因为它们决定复制出去的成品。
- **验收标准**：
  - `grep -rE "backdrop-blur|bg-gradient-to|text-\[1[013]px\]"` 在 WP4 清单文件里结果为 0。
  - `ui/button.tsx` 里不再有 `gradient`。
  - tsc 通过，`pnpm test` 11 个文件全部通过。

## 2. 包间依赖与集成顺序
- 四个包的文件互不重叠，可以同时开工，没有代码上的依赖。只有一处视觉上的耦合：WP1 到 WP3 用 `Button` 时，最终外观取决于 WP4 改完的 `button.tsx`。各包只需要选对 `variant`，不要写死颜色。
- **合并顺序**：WP4 先合（tokens 和 Button），然后 WP1、WP3，最后 WP2（改动最多的文件）。每合一个都跑一次 `pnpm exec tsc --noEmit`。
- **主控最终检查**：
  1. 全部合完后跑 `pnpm exec tsc --noEmit && pnpm test`。
  2. 全仓 `grep -rE "backdrop-blur|bg-gradient-to|text-\[1[013]px\]" app components`，只允许 `components/Editor.tsx` 有残留。
  3. 手工走一遍完整流程：首页输入，看生成流面板（段落可读），进编辑器看核查摘要，进发布包，先看公众号成品再点编辑，然后复制，再看小红书文本框，最后导出 ZIP。
  4. 移动端宽度下确认首页"最近内容"能看到，桌面端侧边栏能列出全部文章。
- **冲突风险**：
  - WP2 的 `page.tsx` 会把 `BriefPanel`、`AgentCompose`（WP4）当黑盒传 props 用，所以两边都不能改这两个组件的 props。
  - WP1 删掉"空白编辑器"以后，`?write=1` 分支在文章页就没有入口了，但代码留着无害，二期再清理。

## 3. 风险与回滚
| 包 | 最大风险 | 回滚方式 |
|---|---|---|
| WP1 | 高级选项收起后，用户找不到 Agent、风格、模板的入口；移动端"最近内容"样式变化导致回不到旧文章 | 单包 `git revert`。把 `advancedOpen` 初始值改成 `true` 就能立即恢复旧形态 |
| WP2 | preview 变成 1500 字后 SSE 包变大，而 delta 每 120 字或 800ms 就发一次，在慢网络下可能卡顿 | 把 `slice(-1500)` 调回 `-600` 或 `-180`，单行改动。verdict 摘要是独立 state 和独立 JSX，可以单独删掉 |
| WP3 | 富文本平台用户找不到"编辑"按钮；去掉宽度切换后，有人确实需要桌面宽度的截图 | 单包 revert。`editing` 初始值改成 `true` 可以临时回到"打开即编辑" |
| WP4 | 机械替换误伤语义色（把状态用的 indigo 或 emerald 也改了）；去掉半透明后层次变平 | 单包 revert。tokens 集中在 `globals.css` 和 `button.tsx`，可以分文件回退 |

## 4. 二期 backlog（本轮明确不做）
1. 流式写入编辑器：编辑器在生成中只读或置灰，边写边渲染，需要重新设计落盘语义。
2. 让 `done` 先于交叉验证发出，验证改成异步跟进或单独一个请求，不再拖慢正文交付。
3. verdict 持久化到 Article（涉及 `types`、`store`、`backup` 和对应测试）。
4. 移动端导航减少层级：设置收进抽屉，平台 tab 吸顶、操作按钮吸底。
5. 删除交互重做：移动端左滑或右键菜单。
6. 文章页"成品预览 / 平台文案"两级 tab 合并成一级。
7. `Editor.tsx` 的视觉收敛和工具栏精简（等未提交改动落地后再做）。
8. 清理 `?write=1` 死分支。
9. Prompt 分阶段拆分，以及去 AI 味的结构化后处理（review 第四节的两条中优先级建议）。
10. 一键直发各平台。
