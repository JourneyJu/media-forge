# ADR 003: Agent 自动执行与必要追问

## 状态

Accepted

## 背景

公众号创作平台面向普通用户。用户看不懂也不需要确认 Agent 的内部执行计划。计划的价值主要在于系统编排、任务进度展示和故障恢复，而不是让用户判断是否执行。

当前实现曾在计划生成后进入确认状态，要求用户点击“按计划执行”。这会打断创作，也容易把内部计划误认为用户需要理解的产品功能。

## 决策

- Run 生成计划后默认自动继续执行。
- 前端可以在对话列表或任务卡中流式展示计划和步骤进度，但不要求用户确认计划。
- 只有当用户信息模糊、缺少关键创作条件、继续生成会明显影响结果质量时，才进入 `waiting_clarification` 并向用户追问。
- `decision.required` 仅用于追问、必要选择或异常恢复，不用于“是否按计划执行”。
- 最终公众号内容只能来自 `Artifact` / `ArticleVersion`，不得混入用户原始输入、执行计划、AI 思考过程或审阅说明。

## 影响

- 前端不再展示“按计划执行”按钮。
- 后端创建 Run 后自动完成当前同步编排流程。
- RunEvent 仍然记录 `step.started`、`step.completed`、`artifact.created` 和 `run.completed`，用于任务进度流式展示。
- 旧 `POST /runs/:runId/decisions` 接口保留给后续 clarification 和兼容场景，但不作为普通生成链路必经步骤。

## 后续

- 增加 clarification policy，判断何时必须追问用户。
- 将对话区改为聊天消息流，并把任务卡作为对话消息展示。
- 增加 artifact schema guard，阻止 prompt、计划和过程说明进入最终公众号正文。
