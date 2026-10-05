# 三期验收报告

## 结论：有条件通过

tsc、测试和 build 都通过，三个包的结构基本符合方案。但 WP-A 有一个确定的 bug：新文章中途点「停止」，已经生成的正文会全部丢失。修掉这一条（大约 3 行）后就可以合。

## 一、客观检查结果

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `pnpm test` | 12 个测试文件，107 条用例全部通过 |
| backup / ai-stages / streaming-request-id / ai-guardrails | 4 个文件、41 条用例全部通过（ai-guardrails 14 条，与 ai-stages 并存没问题） |
| `pnpm build` | `✓ Compiled successfully`；只有 node 的 trace-warnings 提示，没有报错 |
| backup.test 条数 | 18 → 20。验收清单写的是 19 → 20，实际是净增 2 条，与 WP-B 新增 2 条用例一致 |
| 残留引用 | 项目中已没有 `delta.preview`，也没有 `GenerationProgress` 的 `materialType`、`platformCount` 引用（第 1124 行那处属于 `PreviewPane`，无关） |

## 二、各包符合度

**WP-B verdict 持久化：符合**
- `types.ts:52` 的 `verdict?` 紧跟在 `conversation?` 后面。
- `backup.ts` 的 `sanitizeArticleVerdict` 和 `cleanVerdict` 接在 `validateArticles` 末尾；`BACKUP_VERSION` 和 `parseBackup` 的严格相等校验都没动。旧备份没有 verdict 字段时走的是 `verdict === undefined` 分支，直接原样返回，导入路径没有被破坏。
- `page.tsx` 的 5 处改动都在范围内：verdict 改为派生、生成开始时清空、verify 回写用捕获的 `articleId`、`runRefine` 收尾清空、新增润色按钮。
- verdict 用 zustand selector（`page.tsx:56`）派生，store 更新后会立刻重渲染，不会错过最新值。旧文章 `verdict` 为 undefined 时，`page.tsx:975` 的 `{verdict && …}` 不会渲染浮层。

**WP-C 大纲阶段：符合**
- 大纲只在 `length !== 'short'` 时生成，且放在 attempt 外面只生成一次；AbortController 同时接用户 signal 和 20s 超时，`finally` 里会清理 timer 和 listener。
- 大纲为空时，`buildUserPrompt` 里的 `if (outline)` 会跳过，prompt 中完全不出现「写作大纲」段；测试 3 断言了这一点。
- short 时 `createMock` 断言为 0 次，没有多出一次 create 调用。`onOutline('')` 在 short 时仍会被调用，这是对 spec 的轻微扩展，但 `route.ts` 收到空串直接 return，不影响行为。
- 函数签名和 `onText` 契约都没变。

**WP-A 流式写入编辑器：大体符合，有 1 个必须修的问题**
- `delta` 已改为 `{text, reset?}`；`GenerationViewState` 里的 `preview` 和 `verdict` 已删除；节流改为只按 100ms 计时。
- `GenerationProgress` 现在是 83 行的细条；AgentCompose 和 BriefPanel 的死分支 prop 已删，`generating` 保留，按钮会显示「生成中…」。
- 流式期间的 onUpdate 链路：`setContent(html, false)` 不会发 update，另外 `onChange` 本身是空函数，相当于两层保险，store 不会被写。`pendingFromExternal` 的逻辑没改。
- **key 重挂**：主编辑器的 key 是 `article.id`（`page.tsx:1078`），不是 `updatedAt`。但流式编辑器和主编辑器处在两个互斥的 JSX 分支里，done 后一定会卸载再挂载，撤销栈确实会清空，Ctrl+Z 退不到 done 之前的内容。效果达到了，只是 `Editor.tsx:59` 的注释写成了 `updatedAt`，和实现对不上。
- done 时去掉了 500ms sleep，`setStreamText('')` 也有。

## 三、发现的问题

### 必须修

1. **停止时 `streamText` 是旧值，新文章停止后正文丢失**（`page.tsx:537`）。
   - `onGenerate` 是 async 闭包，`catch` 里读到的 `streamText` 是函数创建那一刻的 state，几乎总是 `''`。流式期间 `setStreamText` 的更新这里看不到。
   - 后果：新文章生成到一半点「停止」，store 被写进 `markdownToInlineHtml('')`，已生成的正文全部丢失，而提示文案还说「原稿没有被覆盖」。这个停止语义的核心功能等于没有生效。
   - 修法：在函数体内维护一个局部变量 `let streamed = ''`，收到 delta 时和 `setStreamText` 同步累加（`reset` 时清空），`catch` 里用这个变量；或者改用 `useRef`。

### 建议修

2. **`setEditable` 默认会发出 update 事件**（`Editor.tsx:157`）。Tiptap 2.27 的签名是 `setEditable(editable, emitUpdate = true)`，会 emit `'update'`。
   - 主编辑器挂载时调 `setEditable(true)`，会吃掉原本给初始化准备的 `firstUpdateRef` 跳过标记。
   - 开发环境的 StrictMode 下 effect 会跑两次，第二次的 update 会走到 `onChange(getHTML())` → 写 store、刷新 `updatedAt`、触发保存。
   - 修法：改成 `editor.setEditable(!streaming, false)`。

3. **reset 协议有边界漏洞**（`route.ts:109`）。现在只靠 `snapshot.length < lastSentChars` 判断重试。如果第一次 attempt 失败前 `lastSentChars` 很小（比如只发过首个 chunk），重试的第一个 snapshot 就可能 ≥ 它，reset 不会触发，导致客户端前缀错位。done 会用完整 md 覆盖，所以最终正文不受影响，只是流式期间的显示会乱。更稳的做法是在 `ai.ts` 的 attempt 开头回调一个 `onAttemptStart`，route 收到后无条件发 reset。

4. **大纲等待期间没有对应文案**。medium/long 最多要等 20s，这段时间细条上显示的仍是 `onPrepared` 的「写作风格与结构已写入请求」，用户会以为卡住了。建议在 `generateOutline` 之前先发一条「正在拟大纲」的 stage。

5. **润色按钮的禁用状态不完整**（`page.tsx:1026`）。`disabled` 只看了 `commandBusy` 和内容是否为空，没有包含 `batchProgress`。平台批量生成时按钮看起来可以点，但 handler 会静默 return，什么都不发生。建议把 `Boolean(batchProgress)` 加进 `disabled`。

### 可忽略

6. `Editor.tsx:59` 注释写的是 `key=updatedAt`，实际是靠分支切换完成重挂（见上文）；`page.tsx:1208` 注释写「标题行 + 工具栏沿用 editorPanel」，但生成期间并不渲染 editorPanel。两处都只是注释与实现不一致。
7. 每次 verify 回写都会刷新 `updatedAt`，文章列表里这篇会跳到最前。可以接受。
8. 大纲请求会把完整素材再发一遍，长素材时输入 token 大约翻倍。目前可以接受，以后可以截断素材。
9. `generation-events.ts` 和 `GenerationProgress.tsx` 文件末尾缺换行。

## 四、与北极星的实际推进

- **看得见生成过程**：正文逐字直接出现在只读编辑器里，done 后没有 500ms 延迟就切到可编辑，从「等待卡片 → 跳转」变成了「原地长出来」。这是三期体验上最实在的推进。问题 1 修好前，「停止后保留半成品」这个承诺还没兑现。
- **AI 核查结果不再刷新即丢**：verdict 随文章持久化、能经过备份导入导出，备份里形状畸形的 verdict 只会被丢掉，不会拦住整篇文章。
- **长文结构更稳**：medium/long 先拟大纲再写正文，大纲失败不影响正文；short 的行为与 c0b16c8 一致，不增加任何调用。
- **界面更简单**：生成面板收成细条，两个面板的死 prop 已删，代码净增约 214 行，主要用在流式写入和大纲上。

本次只出报告，没有改任何代码。
