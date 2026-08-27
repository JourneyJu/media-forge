# API：Creation Graph 多 Agent 编排

## 实施状态

本文件描述多 Agent API 的当前能力。Conversation Run 已由原子 Turn 创建并使用 `queued + BullMQ Worker`，任务、输出、事件和追问恢复均接入 PostgreSQL。SSE 使用 PostgreSQL 事件回放和定时补查，Redis Pub/Sub 通知属于后续延迟优化。

目标实现见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。

`docs/specs/015-multi-agent-content-and-layout-quality.md` 的 Turn 上下文、结构化正文和 LayoutPlan 契约已落地。审校达到最大修订次数时，`run.completed` 可携带可选的 `qualityStatus=warning`、`completionReason=max_revision_reached` 和 `unresolvedIssues`，历史客户端可以忽略这些字段。

## 定位

Creation Graph 是后端内部多 Agent 编排模块。普通前端主要使用 `docs/api/conversations.md`，本文件只记录多 Agent 相关的新增或扩展 API。

## Run 创建入口

普通前端不再单独创建 Run。`POST /conversations` 首次 Turn 和 `POST /conversations/:conversationId/turns` 后续 Turn 会在同一事务中创建公众号 Run 和 dispatch outbox。

### Turn 中与 Run 相关的请求片段

```json
{
  "type": "wechat_article_generation",
  "creationMode": "auto",
  "inheritedResourceIds": [],
  "layoutSkillId": "auto",
  "maxSteps": 12
}
```

### Turn 响应中的 Run 片段

```json
{
  "id": "run_1",
  "conversationId": "conversation_1",
  "type": "wechat_article_generation",
  "status": "queued",
  "currentStep": "brief",
  "createdAt": "2026-07-27T00:00:00.000Z"
}
```

规则：

- Turn API 不等待完整文章生成。
- Turn API 创建 Run 后写 `run.created`。
- API 使用 `runId` 作为 BullMQ `jobId`，避免重复入队。
- 数据库提交成功但 Redis 暂时不可用时，通过 dispatch outbox 重试，不静默回退旧同步生成。
- `creationMode` 目标枚举为 `auto|new|revise|continue`；显式值优先于服务端推断。
- `new` 默认只使用本 Turn 的 `resourceIds`；旧资源必须通过 `inheritedResourceIds` 显式选择。
- 服务端不得把历史用户消息拼接为当前 Run 的原始指令。
- V2 `graph_runs.context_json` 必须携带 `schemaVersion=2` 和冻结的 `resolvedRequest`；Worker 不重新解析用户意图。
- `resolvedRequest` 记录 `operation`、`mutationScope`、`contentIdentity`、逐字硬要求、资源范围、约束来源和可复用基线。
- 仅改内容呈现时必须有上一版 `creationSnapshot`；旧 Artifact 缺少快照时使用完整兼容路径。

## `GET /runs/:runId/events`

读取 RunEvent SSE 流。多 Agent 节点进度通过该接口投影给前端。

### 事件示例

```text
id: 4
event: step.started
data: {"runId":"run_1","stepType":"writer","title":"正文创作"}

id: 5
event: step.completed
data: {"runId":"run_1","stepType":"writer","summary":"已完成正文草稿"}

id: 6
event: artifact.created
data: {"runId":"run_1","artifactId":"artifact_1","artifactType":"wechat_article"}
```

事件必须在 Worker 节点真实执行期间写入 PostgreSQL。不得在任务完成后遍历历史步骤制造伪实时事件。

### Agent 流式过程事件

规格 016 扩展以下事件：

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

示例：

```text
id: 21
event: agent.reasoning.delta
data: {"runId":"run_1","stepId":"task_1","agentName":"MaterialAgent","sequence":3,"phase":"thinking","delta":"正在核对素材与当前主题的关系","elapsedMs":8200,"retryCount":0,"createdAt":"2026-08-03T00:00:08.200Z"}

id: 22
event: agent.output.validating
data: {"runId":"run_1","stepId":"task_1","agentName":"MaterialAgent","sequence":4,"phase":"validating","summary":"正在检查素材分析字段","elapsedMs":9100,"retryCount":0,"createdAt":"2026-08-03T00:00:09.100Z"}
```

规则：

- `event_no` 仍是 SSE `id`，`sequence` 只用于单 Agent 增量去重。
- `delta` 单条最多 500 字符，仅允许承载平台映射的安全业务摘要，不承载供应商原始 reasoning。
- `run.heartbeat` 不包含模型文本。
- 事件不得包含系统 prompt、原始思维链、raw JSON、API Key 或供应商错误正文。
- 老客户端可以忽略未知事件，现有 SSE URL 和断线续传语义不变。
- 本节事件已纳入共享 contracts；部署前不得视为环境已上线接口。

## `POST /runs/:runId/clarifications`

用户补充必要信息后恢复 LangGraph。

### 请求

```json
{
  "answers": [
    {
      "questionId": "audience",
      "value": "家长"
    }
  ],
  "idempotencyKey": "client-generated-key"
}
```

### 响应 `200`

```json
{
  "id": "run_1",
  "status": "queued",
  "waitingFor": null,
  "updatedAt": "2026-07-27T00:00:00.000Z"
}
```

规则：

- 只有 `waiting_clarification` 状态可以提交。
- 提交后写 `clarification.submitted`。`decision.submitted` 仅作为旧客户端迁移期兼容事件。
- Worker 使用 LangGraph resume 继续执行。
- 重复提交同一 `idempotencyKey` 返回同一结果。

补充规则：追问提交可携带 `uploadSessionId` 和 `resourceIds`。服务端必须把这些 staged 资源绑定到同一 Conversation 和追问消息，并合并进恢复后的 `RunContext.resourceContext`。

## `GET /runs/:runId/tasks`

读取多 Agent 节点任务状态。主要用于后台、调试和运营，不作为普通用户主界面 API。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "task_1",
      "runId": "run_1",
      "agentName": "BriefAgent",
      "nodeName": "brief",
      "status": "succeeded",
      "startedAt": "2026-07-27T00:00:00.000Z",
      "completedAt": "2026-07-27T00:00:02.000Z"
    }
  ]
}
```

## `GET /runs/:runId/outputs`

读取 Agent 结构化输出。默认仅内部可用。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "output_1",
      "runId": "run_1",
      "type": "creative_brief",
      "schemaVersion": "2026-07-27",
      "payload": {}
    }
  ]
}
```

`AgentOutput.type` 已包含 `material_summary`、`content_plan` 和 `layout_plan`。`layout_plan` 只能包含受控设计令牌和模块引用，不得包含 raw HTML、CSS 或脚本。

### Presentation Director 契约（规格 023，已实施）

`AgentOutput.type=presentation_style_decision` 位于 ArticleDraft 和 ImagePlan 之后、LayoutPlan 之前，并至少包含：

```json
{
  "schemaVersion": "presentation-style-v1",
  "structureVersion": "structure_1",
  "source": "mixed",
  "confidence": 0.9,
  "evidence": "用户指定深蓝；当前内容为克制的舞台获奖纪实。",
  "visual": {
    "theme": "stage-documentary",
    "density": "comfortable",
    "alignment": "left",
    "sectionRhythm": "minimal"
  },
  "colorDecoration": {
    "colorSource": "mixed",
    "requestedColors": ["深蓝"],
    "prohibitedColors": [],
    "paletteIntent": {
      "primary": "深蓝",
      "accent": "低比例暖金",
      "surface": "灰白"
    },
    "ornamentLevel": "minimal"
  },
  "imagePresentation": {
    "heroStrategy": "full-width",
    "grouping": "text-image-alternating",
    "captionPolicy": "fact"
  },
  "brandPresentation": {
    "prominence": "light",
    "logoPlacement": "ending",
    "ctaStyle": "follow"
  }
}
```

示例只说明字段语义，不穷举最终 enum。实现时以 `packages/contracts` 中的 Zod schema 为唯一运行时契约。

`presentation_style_decision` 不得包含：

- raw HTML、CSS、JavaScript 或事件属性；
- 对象存储内部地址或未校验资源 URL；
- 用户完整 prompt、模型思维链或完整 Skill 指令；
- 对正文、标题、章节集合和图片语义归属的改写。

规格 023 实施后，`ReviewerIssue.target` 增加 `presentation`：

- `presentation`：主题、颜色、装饰、图片展示策略或品牌呈现决策不合适，回退 Presentation Director。
- `layout`：LayoutPlan 模块、结构引用或白名单令牌不合法，只回退 Layout Agent。

用户可见步骤继续使用现有 `step.started` 和 `step.completed`，步骤名称为“内容呈现策划”。完成 payload 只包含安全摘要、theme、colorSource 和耗时，不包含原始提示词或模型推理。

Material 节点会对本轮图片调用 `multimodal_generation` 路由，结构化记录场景描述、OCR、质量和建议用途。Skill 品牌资源在 RunContext 中冻结为 `assetId + assetKey + type + usage`；模型只引用 `assetKey`，最终资源地址由 Artifact Builder 按 owner 和 Skill version 的解析结果生成。

安全规则：

- 不返回原始思维链。
- 不返回密钥。
- 不返回未脱敏 prompt。
- 不返回完整 raw model output。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `RUN_NOT_FOUND` | 404 | Run 不存在或无权访问。 |
| `RUN_INVALID_STATE` | 409 | 当前状态不能提交追问答案。 |
| `RUN_JOB_DUPLICATED` | 200/202 | 队列任务已存在，返回当前 Run。 |
| `RUN_CLARIFICATION_REQUIRED` | 409 | 需要先补充信息。 |
| `RUN_OUTPUT_INVALID` | 422 | Agent 输出不符合 schema。 |
| `RUN_EVENT_STREAM_UNAVAILABLE` | 503 | 事件流暂不可用。 |
| `WORKER_UNAVAILABLE` | 503 | Worker 或队列不可用。 |
| `GENERATION_MODEL_UNAVAILABLE` | 503 | 生产环境没有可用的 active 模型路由；不得回退 Demo。 |
| `RUN_CONTEXT_INVALID` | 422 | 创作模式、当前资源或继承资源不满足目标上下文约束。 |
| `PRESENTATION_CONSTRAINT_CONFLICT` | 409 | 目标错误码：用户呈现要求与主动选择的品牌硬约束冲突，需要澄清。 |
| `PRESENTATION_STYLE_INVALID` | 422 | 目标错误码：PresentationStyleDecision 不符合受控 schema。 |
| `PRESENTATION_COLOR_UNSAFE` | 422 | 目标错误码：无法在保留用户颜色锚点时满足可读性和安全规则。 |
| `PRESENTATION_STRUCTURE_STALE` | 422 | 目标错误码：PresentationStyleDecision 的 structureVersion 已过期。 |
| `LAYOUT_PRESENTATION_MISMATCH` | 422 | 目标错误码：LayoutPlan 未落实已确认的呈现决策。 |
| `LAYOUT_PLAN_INVALID` | 422 | LayoutPlan 不符合白名单 schema，禁止进入 Renderer。 |
| `ARTIFACT_VALIDATION_FAILED` | 422 | Artifact Builder 发布前校验失败，错误摘要必须包含具体 violation code，例如 `TITLE_SOURCE_INVALID`。 |
| `REVISION_SNAPSHOT_MISSING` | 422 | 定向修订缺少可信 `creationSnapshot`；旧 Artifact 应走完整兼容路径。 |
| `MUTATION_SCOPE_VIOLATION` | 422 | 局部修订修改了请求范围以外的标题、正文、结构或图片语义。 |
| `VERBATIM_REQUIREMENT_MISSING` | 422 | 用户明确要求逐字保留的内容未出现在最终文章。 |

`TITLE_SOURCE_INVALID` 表示最终标题不是 Title Agent `selectedId` 指向的候选标题。该错误通常说明 Review 后的 Revision 改写了标题，或标题问题没有回退到 Title Agent 重新选择标题。Run 必须 failed，不得生成 `artifact.created` 或可发布预览。

创意主题或 `subject` 未在正文逐字出现不再产生硬失败。迁移期可以记录 `LEGACY_SUBJECT_MISMATCH` 诊断，但不得仅凭该诊断阻止 Artifact。语义完整性由 Reviewer 的 `contentCoverage` 检查实体、事实、观点和逐字要求；结构版本、章节引用、标题来源和 mutation scope 由服务端确定性校验。

### `run.failed` 结构化失败

失败事件继续提供兼容字段 `message`，并附带安全的结构化失败信息：

```json
{
  "runId": "run_1",
  "message": "最终内容未通过发布校验，未生成可发布预览。",
  "failure": {
    "code": "ARTIFACT_VALIDATION_FAILED",
    "stage": "artifact",
    "category": "integrity",
    "recoverability": "revise_input",
    "summary": "最终内容未通过发布校验，未生成可发布预览。",
    "violations": [{ "code": "VERBATIM_REQUIREMENT_MISSING" }]
  }
}
```

`category` 为 `integrity|quality|provider|system`，`recoverability` 为 `retry_same|revise_input|clarify|none`。事件不得包含供应商原始错误、完整 prompt、堆栈或模型 raw output。

## Agent 分析动态事件

`GET /runs/:id/events` 可返回完整替换语义的
`agent.reasoning.summary`。该事件不包含供应商原始 reasoning：

```json
{
  "runId": "run_1",
  "stepId": "step_1",
  "agentName": "WriterAgent",
  "attemptNo": 1,
  "executionId": "8d68b157-4c32-4d86-b0c4-8bf702c6f17d",
  "sequence": 3,
  "revision": 1,
  "phase": "thinking",
  "summary": "正在检查段落结构、主题关系。",
  "category": "check",
  "source": "sidecar_summarizer",
  "visibility": "active_step_only",
  "elapsedMs": 4200,
  "createdAt": "2026-08-24T08:00:00.000Z"
}
```

客户端必须按 `executionId` 隔离执行，并仅接受同一执行中递增的
`revision`。收到 `agent.reasoning.completed` 或 `agent.completed` 后，
应清除临时摘要；失败步骤可以保留最后一条已通过安全检查的摘要。
