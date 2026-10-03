# 二期验收报告

## 结论：通过（没有必须修的问题，附 3 条建议修）

二期的五个包都按方案落地了，「不做」清单没有越界。客观检查全部通过。读 diff 没有发现会出错的逻辑缺陷。有一点需要说明：WP5「生成前预防」只做到了改稿 prompt，首次生成用的 prompt 只覆盖了 1 个新词（见第三节第 1 条）。

## 一、客观检查结果

| 项 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 退出码 0，没有错误 |
| `pnpm test` | 11 个文件、102 个用例全部通过（一期 101 条，加 WP5 新增 1 条） |
| 视觉 grep（任意值字号 / backdrop-blur / bg-white/N） | 0 |
| `'write'` grep | 0 |
| `AI STUDIO` grep | 0 |
| `vitest run tests/streaming-request-id.test.ts` | 4/4 通过 |
| `vitest run tests/editorial.test.ts` | 8/8 通过 |
| StarterKit 配置行 | 仍在 `components/Editor.tsx:67`：`StarterKit.configure({ heading: { levels: [1, 2, 3] } })` |
| `cross-validate.ts` 是否在 diff 中 | 不在 |
| `git diff --stat` | 15 个文件，+222/−121 |

改动范围：方案写的是「只能是 12 个文件」，实际是 15 个。差异来自方案自己数错了：WP1–WP5 列出的文件加起来是 2+8+1+1+2=14 个，再加上 `tests/editorial.test.ts`，正好 15 个。没有方案外的文件。

## 二、各包符合度

**WP1：符合**
- **服务端**（`route.ts:127-146`）：顺序是 `send(done)`，然后 `try { await crossValidateDraft; send(verify) } catch {}`，然后 `clearInterval(heartbeat)`，最后 `if (!cancelled) close()`。done 先于核查发出；heartbeat 等核查结束才清；注释已改写，说明了 90 秒和心跳的关系。
- **pump**（`page.tsx:482-503`）：
  - 退出条件写在 for 循环之后，顺序是 `if (done) break; if (stopWhen()) break;`。也就是先处理完本批事件再查标志。如果 done 和 verify 落在同一批，verify 也不会丢。
  - 后台调用是 `void pump(() => false).catch(() => {})`，没有 await，不会阻塞后面的 500ms 等待、进编辑器和 finally。
  - 两个 pump 共用同一组 reader / buffer / decoder。主 pump 退出时没读完的半条事件留在 buffer 里，由后台 pump 接着拼，不会丢。
- **verdictRunRef**：三个点都有。
  - `:379`：`const verdictRun = ++verdictRunRef.current`
  - `:696`：refine 成功后 `+= 1`，紧接着 `setVerdict(null)`
  - `:455`：verify 分支用 `===` 比较
- **runRefine**（`:657`）：
  - 用的是 const 箭头函数，定义位置（`:657`）在 `if (!article)` 早返回（`:209`）之后，所以 TS 的非空收窄有效。
  - 它用到的原局部变量是 `instruction` 和 `agentId`，都改成了参数传入。其余的 `article`、`aiReady`、`refineController`、`setContent`、`onTitle`、`setLanguage`、`selectWorkspaceStep`、`addConversationMessage`、`runPlatformBatch`、`loadAiConfig` 都是组件作用域里的，闭包可以正常拿到。
  - 抽取后 `onCreativeCommand` 只剩 `await runRefine(instruction, agentId)` 一行，行为不变。
- **一键应用**：
  - `applyVerdictInstruction`（`:1201`）的三种情况都对：问题和建议都有时两段都列；只有其中一项时只列那一项；两者都为空时按钮不渲染（`:968`）。
  - 按钮的 disabled 条件是 `commandBusy || generating || Boolean(batchProgress)`，齐全。
  - `onApplyVerdict` 直接调用 `runRefine(…, 'chief-editor')`，确实绕过了 `onCreativeCommand` 的关键词路由。失败路径和 `onCreativeCommand` 一致：`showError` 加一条对话记录。
  - 没有自动重新核查。
- **死分支清理**：已完成。
- **标题字号**：`text-[22px]` 已改成 `text-2xl`。

**WP2：符合**
- `Italic` 和 `Code` 的按钮与 import 都删干净了。
- H1、H2、加粗、引用、列表、配图、字数都保留。
- StarterKit 没动，所以 Cmd+I 快捷键仍然能用。
- 字号统一映射到 `text-xs`；settings 和 marketplace 的 h1 改成 `text-2xl sm:text-3xl`。
- PlatformTabs「生成其余」按钮固定为 ghost，复制按钮保持 primary（`PlatformTabs.tsx:323`）。

**WP3：符合**
- 是否贴底在 `onScroll` 里计算（`< 80`），自动滚动的 effect 只在 `stickRef.current` 为真时才滚。顺序正确。
- effect 里程序设置 scrollTop 也会触发一次 onScroll，正好把贴底状态重新置为真。
- `denoise` 只去掉行首的 `#` 和所有 `**`，行首的 `-` 保留。
- 没有引入 Markdown 渲染库。

**WP4：符合**
- 外框去掉了 `overflow-hidden`。
- textarea 加了 `rounded-t-2xl`；底栏是最后一个有白底的子元素，加了 `rounded-b-2xl`。中间区块的白底不碰圆角，不会露出直角。
- 三个菜单（`:178 / :229 / :271`）都加了 `max-h-[60vh] overflow-y-auto`。

**WP5：基本符合**
- 9 个词齐全：值得注意的是、总的来说、综上所述、总而言之、众所周知、不言而喻、毋庸置疑、赋能、抓手。severity 保持 low。
- `REFINE_SYSTEM` 里的示例已同步。
- 新单测断言 `{severity:'low', message:'…"综上所述"'}`，能命中。
- 偏差见第三节第 1 条。

## 三、发现的问题

**必须修**：无。

**建议修**
1. **首次生成的 prompt 没有同步新词。** `src/lib/ai.ts:268` 改的是 `REFINE_SYSTEM`，也就是改稿用的 prompt。首次生成用的是 `MASTER_SYSTEM`（`ai.ts:98`），它引用的是 `EDITORIAL_RULES`（`src/lib/editorial.ts:9`，第 3 条），里面只有「值得注意的是」一个新词。方案写的是「`ai.ts:267` 生成 prompt」，但第 267 行其实是改稿 prompt，施工方照字面做了。结果是「生成前预防」只覆盖了改稿，第一次生成仍可能写出「综上所述」「赋能」，然后被事后检测报出来。
   - 改法：在 `editorial.ts:9` 第 3 条里补上「综上所述」「赋能」等词，一行改动。
2. **一键应用后，对话里的回复很长。** `page.tsx:706-707` 的收尾消息是 `已按“${instruction}”…`。一键应用时，instruction 是拼好的多行核查意见全文，所以对话里会出现一大段「已按“按以下核查意见修改全文……问题：- … 建议：- …”更新完整母稿」。
   - 改法：给 `runRefine` 加一个可选的展示文案参数，一键应用时传「核查建议」。
3. **verify 分支还在往 `generationProgress` 写 verdict，但已经没有人读它。** 位置是 `page.tsx:450-453`，另外 `:431` 和 `:468` 的 `...(previous?.verdict…)` 在把它往后传。GenerationProgress 组件不渲染 verdict，页面里也没有地方读 `generationProgress.verdict`。改成异步后，旧一轮的迟到 verify 可能写进新一轮的进度状态。现在没有可见影响，但这是无用代码，建议删掉三处，大约 −8 行。

**可忽略**
- `page.tsx:719`：`runRefine` 的结尾 `}` 少了分号。ASI 能正确处理，只是风格不一致。
- done 之后的后台读流不响应停止按钮，因为 finally 里已经把 `generationController` 置空。紧接着重新生成，或者离开页面时，旧连接会一直挂到核查结束，最长 90 秒，服务端也继续跑完这次核查。结果会被 verdictRunRef 丢弃，不会显示错误，只是浪费资源。方案已经接受这一点。
- 流面板的 preview 是 `slice(-1500)` 截出来的，超过 1500 字后开头会被持续截掉。所以用户往上翻时不会被拽回底部，但眼前的文字仍会随新增内容往上滑。要彻底解决，得等 #1「流式写入编辑器」。
- `pump` 里 `applyEvent` 对 error 事件的 throw 会被「解析失败」的 catch 吞掉，用户最后看到的是「生成连接提前结束」，而不是服务端发来的错误原文。这是一期就有的问题，二期没有让它变差。建议进 backlog。

## 四、与北极星的推进

- **极简（约 75% → 约 82%，和预期一致）**：全仓的任意值字号和玻璃态残留都清零了。编辑器工具栏少了两个按钮；平台页只剩复制一个实心按钮；`?write=1` 死分支删除。剩余断点：文章页两级 tab（#6），以及标题行拥挤（#4）——标题行现在多了核查摘要和一键应用入口。
- **丝滑（约 50% → 约 65%）**：最大的收益落地了。核查最长 90 秒，现在不再阻塞进编辑器，读到 done 后 0.5 秒就进入。流面板不再把用户拽回底部，也看不到 `#` 和 `**` 了。剩余断点：生成完要「跳」进编辑器（#1），preview 截断导致的文字滑动，以及 done 之后没有取消入口。
- **AI native（约 40% → 约 48%，略低于预期的 50%）**：「AI 审 → AI 改」第一次形成闭环，而且绕开了关键词误路由，这部分已经成立。打折的原因是第三节第 1 条：「生成前预防」目前只在改稿时生效，首次生成没有。下一步：verdict 持久化（#3）、改稿后自动复核、核查进行中的状态提示。
