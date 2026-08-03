# 规格：多 Agent 流式过程反馈

## 实施状态

共享事件契约、Model Gateway 流式适配、Worker 进度事件与心跳、运行超时以及 Chat Workspace 过程面板已在本地实现，待提交和部署后进入环境验证。

## 背景

当前 Creation Graph 只在节点开始和完成时写入进度事件。单次模型调用可能持续数十秒，期间前端没有新事件，用户会误以为任务卡死；如果模型调用、结构校验或 Worker 在终态写入前失败，页面还可能停留在普通 Assistant 提示后静默结束。

本规格把模型调用期间的可展示推理摘要、执行阶段、心跳、校验和重试状态转换为可恢复的 `RunEvent`，通过现有 SSE 实时显示在对话任务卡中。任务完成后全部 Agent 过程默认收起，失败 Agent 保持展开。

## 安全定义

本规格中的“思考”是面向用户的 **推理摘要和执行轨迹**，不是模型原始思维链。

允许展示：

- 当前 Agent 正在处理的业务阶段。
- 模型供应商明确返回的 `reasoning_content` 只作为活跃信号，由平台映射为当前 Agent 的安全业务摘要。
- 输入素材数量、目标字段、校验阶段和重试原因的用户可理解说明。
- Agent 耗时、重试次数和最近活动时间。

禁止展示或持久化到用户事件：

- 系统 prompt、开发者指令、完整 Skill 指令。
- 模型原始长思维链、内部自言自语和完整 raw output。
- API Key、模型连接配置、内部 URL、数据库标识和工具参数。
- 未脱敏隐私、越权资源信息和安全策略细节。

不支持 `reasoning_content` 的模型使用平台根据执行阶段生成的确定性进度摘要，不伪造模型观点。

## 目标

- 模型调用期间每 5 秒内至少产生心跳或有效进度反馈。
- 用户可以看到当前 Agent、当前阶段、耗时和最近活动。
- 支持 OpenAI-compatible 流式 `content` 与可选 `reasoning_content`。
- 结构化 JSON 只在服务端完整组装和校验，不把残缺 JSON 展示给用户。
- SSE 断线或页面刷新后可以从 `Last-Event-ID` 恢复。
- Run 必须产生唯一终态，不能静默结束或永久停在 running。
- 完成后全部过程默认收起；失败节点保持展开并显示可理解错误。

## 非目标

- 不展示模型供应商的原始思维链。
- 不把流式草稿作为 `Artifact` 或 `ArticleVersion` 事实源。
- 不使用 WebSocket 替换 SSE。
- 不把 LangGraph 内部事件、tool call 或 raw prompt 直接暴露给浏览器。
- 不承诺所有模型都能提供 token 级推理摘要。

## 总体链路

```text
Model stream
→ Model Gateway 解析 reasoning/content delta
→ Worker 脱敏、限长、缓冲和阶段转换
→ PostgreSQL run_events
→ GET /runs/:id/events SSE
→ Chat reducer
→ Agent 过程面板
```

Redis / BullMQ 继续负责任务调度，不保存不可丢失的过程事实。PostgreSQL `run_events` 是 SSE 回放事实源。

## 模型网关

模型网关新增可选流式结构化调用：

```ts
generateStructuredJsonWithGateway(config, {
  ...options,
  stream: true,
  onReasoningDelta,
  onContentDelta,
  onPhaseChanged
});
```

规则：

1. 发送 `stream=true`，解析 OpenAI-compatible SSE chunk。
2. `delta.reasoning_content` 只进入安全摘要流水线。
3. `delta.content` 在服务端缓冲，直到流结束后再执行 `JSON.parse + Zod`。
4. 前端不得收到残缺 JSON、schema 字段草稿或完整模型输出。
5. 首次 schema 校验失败时写 `agent.retry.started`，携带安全错误摘要，然后执行一次纠错重试。
6. 两次调用的 token、耗时和请求 ID 汇总到同一模型用量事件。
7. 供应商不支持流式或返回不兼容格式时，可以回退为非流式调用，但必须继续发送阶段事件和心跳。

## 执行阶段

每个 Agent 对用户暴露以下阶段：

```text
queued
→ thinking
→ generating
→ validating
→ retrying（可选）
→ completed | failed
```

阶段仅代表产品执行状态，不等同于 LangGraph 内部节点状态。

## RunEvent 契约

新增事件：

```text
agent.started
agent.progress
agent.reasoning.delta
agent.reasoning.completed
agent.output.validating
agent.retry.started
agent.completed
agent.failed
run.heartbeat
```

公共 payload：

```ts
type AgentProgressPayload = {
  runId: string;
  stepId: string;
  agentName: string;
  sequence: number;
  phase: "thinking" | "generating" | "validating" | "retrying";
  delta?: string;
  summary?: string;
  elapsedMs: number;
  retryCount: number;
  createdAt: string;
};
```

约束：

- `sequence` 在单个 `stepId` 内递增，用于增量去重。
- SSE `id` 继续使用 Run 级 `event_no`。
- `delta` 单条最大 500 字符。
- 每个 Agent 只发布平台映射的安全业务摘要，不持久化供应商原始 reasoning 增量。
- `run.heartbeat` 不包含模型文本，只包含当前步骤、阶段、耗时和最近活动时间。
- `agent.failed` 和 `run.failed` 必须携带用户可理解错误码，不包含供应商响应原文。

## 写入与限频

- Worker 在内存中缓冲模型增量。
- 每个 Agent 首次收到 reasoning 活跃信号时写一条 `agent.reasoning.delta` 安全业务摘要。
- 每 5 秒写一次 `run.heartbeat`；同期已有进度事件时可以跳过。
- Agent 完成时写 `agent.reasoning.completed` 和 `agent.completed`，并保存最终摘要。
- Run 完成后不再写 heartbeat。
- 原始增量设置短期保留策略；最终摘要和终态事件按 Run 生命周期保留。

## 超时与恢复

默认阈值：

| 项目 | 默认值 | 行为 |
| --- | --- | --- |
| 首个模型增量 | 20 秒 | 显示仍在等待模型响应，并记录慢调用指标 |
| heartbeat | 5 秒 | 更新最近活动时间 |
| 前端无进度提示 | 20 秒 | 显示“模型仍在处理” |
| 单 Agent | 180 秒 | 终止模型调用并写 Agent/Run failed |
| 整个 Run | 10 分钟 | 标记超时并停止后续节点 |
| schema 纠错 | 1 次 | 第二次失败后终止节点 |

增加运行恢复扫描：超过阈值仍为 `running` 且 Worker 无有效租约的 Run 必须转为 failed 或重新入队，不能永久挂起。

## 前端交互

任务卡按 Agent 展示可展开过程面板：

- 当前执行 Agent 自动展开并实时追加摘要。
- 已完成 Agent 默认折叠，可手动展开。
- Run 完成后全部 Agent 自动收起，任务卡整体保持可展开。
- 失败 Agent 保持展开，显示失败阶段、耗时和重试入口。
- 每个 Agent 显示状态图标、阶段、耗时和最近更新时间。
- 20 秒无新事件时显示等待提示，不把任务误标为完成。
- 只有收到 `run.completed`、`run.failed`、`cancelled` 或 `waiting_clarification` 才结束当前 Run UI 状态。
- 刷新后根据回放事件恢复面板摘要和终态，不恢复原始未持久化 token。

## 终态规则

每个 Run 必须且只能进入一个终态：

```text
completed
failed
cancelled
waiting_clarification
```

Service 不得因为 SSE 断开、浏览器关闭或模型流结束而自行推断完成。`run.completed` 只能在 Artifact 成功持久化后写入；任何异常路径必须写 `run.failed`。

## 可观测性

记录以下指标：

- 首个模型增量延迟。
- Agent 总耗时和各阶段耗时。
- 心跳缺失次数。
- 流式与非流式回退次数。
- schema 重试次数与最终失败率。
- SSE 重连和回放事件数。
- 长时间 running Run 数量。

日志只记录 `runId`、`stepId`、模型配置 ID、阶段、耗时和错误码，不记录推理文本、prompt 或密钥。

## 兼容策略

- 老前端忽略未知事件，继续消费 `step.started`、`task.card.updated` 和终态事件。
- 新前端在没有 Agent 增量事件时继续展示现有任务卡。
- 现有 `assistant.message.*` 保留，用于 Assistant 面向用户的正式消息，不承载 Agent 原始增量。
- 现有 RunEvent SSE URL 和 `Last-Event-ID` 语义不变。

## 验收标准

- 正常生成期间最长 5 秒内可以看到阶段或心跳更新。
- 支持 reasoning 的模型可以流式展示安全摘要。
- 不支持 reasoning 的模型仍有真实阶段进度，不出现假思考内容。
- schema 重试过程对用户可见，但不暴露非法 JSON。
- SSE 断线恢复后事件不重不漏。
- Run 完成后全部 Agent 自动收起。
- Agent 失败时 UI 明确展示失败，不静默消失。
- 最终公众号正文不包含任何过程摘要或模型思考。

## 文档路由

- ADR：`docs/adr/011-safe-agent-reasoning-stream.md`
- Creation Graph：`docs/modules/creation-graph/README.md`
- Conversation：`docs/modules/conversations/README.md`
- Chat Workspace：`docs/modules/chat-workspace/README.md`
- API：`docs/api/creation-graph.md`、`docs/api/conversations.md`
- 测试：`docs/testing/plans/creation-graph.md`、`docs/testing/plans/chat-workspace.md`
