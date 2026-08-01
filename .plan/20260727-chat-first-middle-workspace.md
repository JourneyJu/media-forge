# L 级子计划：中间区域对话式创作工作区

## 背景

当前创作页中间区域仍偏向表单输入，AI 返回、任务进度和追问没有统一落在对话列表中。右侧手机预览还残留任务状态，这会让用户误以为预览区也承担执行过程。

新的产品方向是：中间区域负责沟通和任务过程，右侧只负责手机端公众号预览。

## 需求分级

L 级子计划。

原因：

- 改变核心创作交互。
- 需要新增前端聊天状态模型和组件拆分。
- 需要扩展 SSE 事件契约。
- 需要后端保存 AI 可见消息。
- 需要明确最终文章正文和 AI 过程的隔离边界。

## 目标

- 中间区域升级为聊天式工作区。
- 点击发送后立即显示用户消息。
- AI 可见回复流式输出。
- 多 Agent 任务进度在对话列表中以任务卡展示。
- 信息不足时用追问卡向用户取信息。
- 右侧预览删除任务状态，只展示公众号预览和 HTML。
- 最终公众号正文不包含用户原始输入、执行计划、AI 过程或审阅说明。

## 非目标

- 不展示模型原始思维链。
- 不让用户确认执行计划。
- 不重构右侧手机预览主体。
- 不在本阶段实现微信公众号发布。

## 影响范围

| 范围 | 影响 |
| --- | --- |
| `apps/web` | 新增聊天工作区组件、消息 reducer、SSE 事件归并、任务卡和追问卡。 |
| `apps/service` | 扩展 RunEvent，保存 assistant visible message，Artifact 创建后推送事件。 |
| `packages/contracts` | 新增或扩展 ChatMessage、RunEvent、TaskCard、Clarification 相关契约。 |
| `docs` | 已新增规格、模块、API、测试方案和测试用例。 |

## 实施阶段

### 阶段 1：契约和前端状态

- 在 `packages/contracts` 增加 ChatMessage 和 RunEvent 扩展类型。
- 在前端新增 `chatReducer` 和事件投影逻辑。
- 保持后端旧事件兼容。

验证：

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/web typecheck
```

### 阶段 2：中间区域组件化

- 从 `page.tsx` 拆出 `ChatWorkspace`。
- 新增 `MessageList`、`MessageBubble`、`AgentTaskCard`、`ClarificationCard`、`ChatComposer`。
- 删除右侧预览的任务状态条。

验证：

```bash
pnpm --filter @mediaforge/web typecheck
```

### 阶段 3：后端可见消息事件

- 后端 Run 事件中新增 `assistant.message.created`、`assistant.message.delta`、`assistant.message.completed`。
- 后端写入 ConversationMessage 时只保存用户可见内容。
- 后端将 Agent 进度映射为 `task.card.updated`。

验证：

```bash
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/service test
```

### 阶段 4：追问和恢复

- 将信息不足事件统一为 `clarification.required`。
- 前端展示追问卡。
- 用户回答后恢复原 Run。

验证：

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
```

### 阶段 5：内容隔离验收

- 最终正文只来自 Artifact Builder。
- 检查用户输入、执行计划、AI 过程、审阅说明不会进入正文。
- 失败时不把半成品当成最终预览。

验证：

```bash
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/web typecheck
```

## 相关文档

- `docs/specs/005-chat-first-middle-workspace.md`
- `docs/modules/chat-workspace/README.md`
- `docs/api/chat-workspace.md`
- `docs/testing/plans/chat-workspace.md`
- `docs/testing/cases/chat-workspace.md`
