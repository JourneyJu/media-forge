# 规格：LangGraph 多 Agent 生产化补全

## 状态

Implemented（主链路，2026-07-27）。

已完成：

- Conversation、Message、Resource、Run、AgentTask、AgentOutput、RunEvent、Artifact 和 Outbox 持久化。
- `202 queued + Redis / BullMQ + apps/worker` 后台执行链路。
- Brief、Clarification、Title、Outline、Writer、ImagePlan、Review、Revision 和 Artifact Guard。
- PostgreSQL 事件回放、SSE 对话消息、真实 Agent 任务卡、追问和结果通知。
- 同一 Run 追问恢复，以及页面刷新后的消息、Run 和 Artifact 恢复。
- 生产默认 `MODEL_MODE=gateway`；本地演示必须显式使用 `MODEL_MODE=demo`。

后续增强：

- 尚未接入 LangGraph 原生 PostgreSQL checkpoint。当前使用版本化 `graph_runs.context_json` 恢复并重新执行图，业务事实不丢失，但可能重复早期节点调用。
- SSE 当前每 250ms 从 PostgreSQL 补查，已支持断线续传；Redis Pub/Sub 通知仍是低延迟优化项。
- MinIO 的 prompt 脱敏快照和 HTML 快照尚未接入。

## 背景

项目已经选定 ADR 004 的 B 方案：`LangGraph.js + BullMQ Worker`。当前仓库已经具备共享契约、LangGraph 图、BullMQ Queue/Worker 骨架、Conversation API、RunEvent SSE 和前端对话任务卡，但公众号创作主链路仍然调用旧的同步 `agent-runs`。

当前结果中出现“用户整段提示词成为标题和正文”的直接原因是：

```text
Conversation 最新用户消息
→ 整段内容赋给 topic
→ 旧生成器执行 title = topic
→ 正文继续插值 topic
```

这不是标题质量调优问题，而是上下文、需求、主题、标题和最终产物没有形成结构化边界。

## 当前实现盘点

### 已实现

- `@langchain/langgraph`、`bullmq`、`ioredis` 已加入后端依赖。
- `infra/docker/docker-compose.yml` 已声明 `redis:7-alpine`。
- `apps/service/src/creation-graph` 已有 Graph、Queue 和 Worker 骨架。
- Conversation、RunEvent、CreationGraphState 和 ChatMessage 已有初步契约。
- 前端已支持对话消息、任务卡、SSE 消费和右侧手机预览。

### 已实现但不满足目标

| 范围 | 当前行为 | 问题 |
| --- | --- | --- |
| Run 创建 | Conversation API 调用旧 `agentRuns.create()` | 不入 BullMQ，不执行 LangGraph |
| 执行方式 | HTTP 请求内同步完成 | API 阻塞，SSE 只能事后回放 |
| Brief | 整段用户消息作为 `topic` | 用户指令、主题和约束混在一起 |
| Title Agent | 截取输入前 36 个字符 | 没有标题生成、评分和选择 |
| Writer | 固定模板或单次生成 | 不消费完整结构化 Agent 产物 |
| Review | 固定分数并通过 | 没有真实审校和修订循环 |
| Worker 上下文 | `userInput`、`resourceIds` 为空 | 即使入队也无法真实创作 |
| RunEvent | 任务完成后遍历步骤生成事件 | 不是真实时执行进度 |
| 本地 Demo | 模型配置缺失时自动启用 | 容易把演示内容当成真实结果 |

### 尚未实现

- Redis 容器实际启动和健康验证。
- Conversation Run 入队和 Worker 消费主链路。
- Graph Run、AgentTask、AgentOutput、RunEvent 和 checkpoint 持久化。
- Worker 从 PostgreSQL 读取当前 Conversation 上下文。
- Brief、Title、Outline、Writer、Image、Review 的真实模型调用。
- Clarification 提交、checkpoint resume 和幂等。
- Worker 到 API 的跨进程实时事件通知。
- Artifact Builder 内容污染校验。
- Redis、Worker、模型和 SSE 故障处理。
- 真实多 Agent 端到端测试。

## 目标

- 将 ADR 004 的目标架构接入公众号创作主链路。
- 将用户原始输入、结构化创作需求、标题候选、正文草稿和最终 Artifact 分层。
- 由 Worker 在后台执行 LangGraph，不阻塞 HTTP 请求。
- 在中间对话区域真实展示多 Agent 阶段进度和面向用户的可见回复。
- 最终公众号内容不包含用户指令、执行计划、思维过程或审校说明。
- PostgreSQL 保存不可丢失事实，Redis 只承载队列、锁和短期通知。

## 非目标

- 不接入微信公众号直接发布。
- 不展示模型原始思维链、内部 prompt、tool call 或 raw output。
- 不使用 LangGraph Agent Server / Platform。
- 不允许 Agent 任意调用外部工具。
- 不在本阶段进行模型微调。
- 不做 token 级最终公众号正文预览写入。

## 需求分级

```text
需求分级：L
分级理由：改变公众号创作主链路、服务边界、数据库 schema、队列运行方式和 AI 调用链路
影响面：apps/web、apps/service、apps/worker、packages/contracts、PostgreSQL、Redis、Model Gateway、文档和测试
是否需要人工确认：是
```

## 设计原则

1. `ConversationMessage.content` 是原始事实，但不是文章主题。
2. `CreativeBrief.subject` 只能由 Brief Agent 结构化提取。
3. 标题只能来自 Title Agent 的候选集合和自动选择结果。
4. Writer Agent 不直接消费未经隔离的原始用户提示词。
5. Agent 只写结构化输出，Artifact Builder 是最终产物唯一入口。
6. PostgreSQL 是 Run、事件、Agent 输出和 Artifact 的事实源。
7. Redis 不保存不可丢失业务事实。
8. 前端显示可理解的阶段与结果摘要，不显示思维链。
9. 模型不可自行决定无限循环，Revision 次数由 policy 限制。
10. 生产环境不得静默回退到 Demo 生成器。

## 目标架构

```text
apps/web
  → POST ConversationMessage
  → POST Run
  → GET RunEvent SSE
  → GET Artifact

apps/service
  → 校验权限、配额和输入
  → PostgreSQL 创建 queued Run 和 run.created
  → Outbox / Dispatcher 投递 BullMQ job
  → 从 PostgreSQL 回放 RunEvent
  → 订阅 Redis 事件通知并推送 SSE

Redis / BullMQ
  → creation-run queue
  → job retry / lock / concurrency
  → RunEvent 短期通知

apps/worker
  → 读取 PostgreSQL Conversation 上下文
  → 执行 LangGraph
  → 调用 Model Gateway
  → 写 AgentTask / AgentOutput / RunEvent
  → 创建 Artifact / ArticleVersion

PostgreSQL
  → Conversation / Message / Resource
  → Run / RunEvent
  → AgentTask / AgentOutput
  → LangGraph checkpoint
  → Artifact / ArticleVersion

MinIO / S3
  → 素材、HTML snapshot
  → 脱敏 prompt / raw output snapshot
```

## Redis 本地运行

Redis 不安装到 Windows 主机，由 Docker Compose 拉取并运行：

```bash
pnpm infra:up
docker compose -f infra/docker/docker-compose.yml ps redis
docker exec mediaforge-redis redis-cli ping
```

期望：

```text
PONG
```

应用配置：

```text
REDIS_URL=redis://localhost:6379
```

规则：

- Docker daemon 未运行时，先启动 Docker Desktop。
- API 或 Worker 无法连接 Redis 时必须暴露健康错误。
- 不得因为 Redis 不可用而静默走旧同步生成链路。
- 入队失败的 Run 必须可重新投递，不能永久停在 `queued`。

## 上下文与队列契约

### Queue Job

BullMQ Job 只携带定位和版本信息：

```ts
type CreationRunJob = {
  runId: string;
  conversationId: string;
  workspaceId: string;
  contextVersion: number;
  graphName: "wechat_article_creation";
  graphVersion: string;
};
```

用户原始输入、资源详情和业务事实不作为 Redis 唯一副本。Worker 根据 ID 和 `contextVersion` 从 PostgreSQL 读取：

```text
当前 Conversation 消息
当前 ConversationResource
资源识别摘要
选择的 Skill 及版本
WorkspaceMemory 摘要
当前 Run 的补充回答
```

一个 Run 只能读取当前 Conversation 的上下文，不读取其他会话的消息。

## 核心结构化产物

### CreativeBrief

```ts
type CreativeBrief = {
  subject: string;
  goal: "brand" | "promotion" | "event" | "education" | "story";
  audience: string;
  contentType: string;
  campaignObject?: string;
  tone: string;
  storyAngle: string;
  materialRequirements: string[];
  resourceIds: string[];
  constraints: string[];
  prohibitedContent: string[];
  skillId: string;
};
```

`subject` 是简短创作主题，例如“儿童摄影团队品牌宣传”，不得是“帮我做一个公众号文案，要求如下……”。

### TitleCandidates

```ts
type TitleCandidates = {
  items: Array<{
    id: string;
    title: string;
    subtitle?: string;
    angle: string;
    audienceFit: number;
    brandFit: number;
    clickPotential: number;
    riskFlags: string[];
  }>;
  selectedId: string;
  selectionReason: string;
};
```

规则：

- 默认生成 3–5 个候选。
- 由 policy 根据受众匹配、品牌表达、传播力和风险自动选择。
- 普通用户不需要确认标题才能继续执行。
- 标题不得等于原始用户输入，也不得包含指令性前缀。

### ArticleOutline

必须描述：

- 开场钩子。
- 故事或场景主线。
- 核心信息和商业表达。
- 素材插入位置。
- 行动引导。
- 每个章节的目标和禁止重复内容。

### ArticleDraft

Writer Agent 只接收：

```text
CreativeBrief
TitleCandidates.selected
ArticleOutline
资源摘要
Skill 约束
Revision 指令
```

Writer Agent 不直接接收完整 `ConversationMessage.content`，避免原始指令进入正文。

### ImagePlan

必须覆盖：

- 封面图选用或生成建议。
- 正文图片顺序和章节位置。
- 多图是否需要拼图、对比图或组图。
- 已上传资源与图片位置的映射。
- 缺失图片的生成描述。

### ReviewReport

```ts
type ReviewReport = {
  passed: boolean;
  scores: {
    story: number;
    commercial: number;
    audienceFit: number;
    naturalness: number;
    wechatReadability: number;
    factualRisk: number;
  };
  issues: Array<{
    code: string;
    severity: "warning" | "error";
    target: "title" | "outline" | "body" | "image" | "cta";
    instruction: string;
  }>;
};
```

Review 不得固定返回通过。存在 `error` 时进入 Revision，最多两轮。

## LangGraph 主图

```text
START
→ Context Loader
→ Brief Agent
→ Clarification Policy
   ├─ 信息不足 → waiting_clarification → END
   └─ 信息充分
→ Title Agent
→ Title Selection Policy
→ Outline Agent
→ Writer Agent
→ Image Planner Agent
→ Reviewer Agent
→ Revision Policy
   ├─ 未通过且未超限 → Revision Agent → Reviewer Agent
   ├─ 未通过且超限 → failed
   └─ 通过
→ WeChat Renderer
→ Artifact Builder
→ END
```

Clarification 只在缺失信息会显著改变文章方向时触发，不用于确认执行计划。

## Agent 执行与可见任务映射

内部 Agent 名称与用户可见步骤分离：

| 内部节点 | 用户可见步骤 | 可见完成摘要示例 |
| --- | --- | --- |
| `brief` | 需求理解 | 已识别主题、受众和宣传目标 |
| `title` | 标题策划 | 已推荐《把童年留在镜头里》 |
| `outline` | 结构设计 | 已完成故事线和商业信息结构 |
| `writer` | 正文创作 | 已完成公众号正文草稿 |
| `image_plan` | 配图规划 | 已安排封面和正文素材位置 |
| `review/revision` | 质量审校 | 已通过故事性和微信阅读检查 |
| `render/artifact` | 微信排版 | 已生成手机预览和兼容 HTML |

前端可以显示“多个创作角色正在协作”，但不得展示原始推理、内部 prompt 或模型调用参数。

## Run 与事件

### Run 创建

```text
POST /conversations 或 POST /conversations/:conversationId/turns
→ PostgreSQL transaction
  → 创建或追加 Conversation Message 和 Resource 关系
  → 创建 Run(status=queued)
  → 写 run.created
  → 写 dispatch outbox
→ 返回 202
→ Dispatcher 投递 BullMQ
```

API 不等待文章生成完成。

Conversation 生命周期、历史排序和资源归属以 `docs/specs/007-conversation-lifecycle-and-resource-ownership.md` 为准。旧独立 Run 创建接口只在迁移期兼容。

### RunEvent

```text
run.created
run.started
step.started
step.completed
task.card.updated
assistant.message.created
assistant.message.delta
assistant.message.completed
clarification.required
clarification.submitted
artifact.created
run.completed
run.failed
```

每个事件先写 PostgreSQL，再发送 Redis 短期通知。SSE 先根据 `Last-Event-ID` 回放数据库事件，再订阅实时通知。

`assistant.message.*` 只承载面向用户的说明，例如：

```text
我已经识别出这是一篇面向儿童家长的摄影团队品牌文章，
接下来会用成长故事作为主线，并把不同风格照片安排到对应章节。
```

不得承载模型思维链、审校原文或内部执行计划。

## Artifact Builder

Artifact Builder 是唯一允许创建 `wechat_article` Artifact 和 ArticleVersion 的入口。

必须执行：

1. `ArticleDocument` schema 校验。
2. 标题来源校验，必须引用 `TitleCandidates.selectedId`。
3. 原始提示词污染检查。
4. 执行计划、审校说明和 AI 过程语言检查。
5. 标题长度、正文完整性和微信兼容块检查。
6. 图片资源归属和可访问性检查。
7. `runId` 幂等检查。
8. Renderer 输出和版本快照保存。

禁止进入最终正文的内容：

```text
用户原始 prompt
“帮我写一篇”“要求如下”等指令文本
Agent 执行计划
模型思考过程
审校报告
内部 prompt
工具调用参数
未经 schema 校验的 raw model output
```

Guard 失败时进入 Revision；达到最大 Revision 次数后写 `run.failed`，不得创建 Artifact。

## 数据模型

PostgreSQL 至少新增或补齐：

```text
graph_runs
agent_tasks
agent_outputs
run_events
run_dispatch_outbox
langgraph.checkpoints
langgraph.checkpoint_writes
langgraph.checkpoint_blobs
```

关键规则：

- `graph_runs.run_id` 与产品 Run 一一对应。
- `agent_tasks` 记录节点状态、重试次数、开始和完成时间。
- `agent_outputs` 保存版本化结构化输出，不保存思维链。
- `run_events(run_id, event_no)` 唯一。
- `run_dispatch_outbox.run_id` 唯一，保证可重派。
- Artifact Builder 使用 `run_id + artifact_type` 保证幂等。

## 故障处理

| 故障 | 系统行为 |
| --- | --- |
| Docker / Redis 未启动 | 健康检查失败；开发环境提示启动基础设施 |
| Run 已创建但入队失败 | Outbox 保留待投递状态并重试 |
| Worker 未运行 | Run 保持 queued；监控超过阈值后标记异常 |
| Worker 节点临时失败 | BullMQ 按退避策略重试 |
| Worker 重复消费 | 根据 runId 和 AgentTask 状态幂等跳过 |
| 模型输出不符合 schema | 写 `RUN_OUTPUT_INVALID`，进入修复或失败 |
| SSE 断线 | 使用 `Last-Event-ID` 从 PostgreSQL 续传 |
| Redis 通知丢失 | SSE 定期从 PostgreSQL 补查，事件不丢失 |
| Artifact 校验失败 | 不创建 ArticleVersion，进入 Revision 或 failed |
| 模型配置缺失 | 返回 `GENERATION_MODEL_UNAVAILABLE`，不自动 Demo |

## 本地 Demo 边界

本地 Demo 只能显式启用：

```text
MODEL_MODE=demo
```

默认行为：

- 开发和生产环境缺少 Model Gateway 配置时明确失败。
- Demo 产物必须标记 `model.mode=local-demo`。
- Demo 不参与多 Agent 质量验收。
- UI 不得把 Demo 结果标记为正式 AI 生成结果。

## 前端行为

- 用户发送后立即插入用户消息。
- Run 返回 `queued` 后立即创建任务卡并打开 SSE。
- 任务卡随真实节点事件推进，不播放任务完成后的伪进度。
- Assistant 可见回复通过 `assistant.message.*` 流式更新。
- Clarification 卡提交后调用 resume API。
- Artifact 创建后才刷新右侧手机预览。
- 任务完成后任务卡自动收起，右侧不展示任务状态。
- 页面刷新后从 Conversation、Run 和 RunEvent 恢复。

## 迁移策略

### 双引擎阶段

```text
CREATION_ENGINE=legacy
CREATION_ENGINE=langgraph
```

- 默认开发环境在基础设施和测试完成后切到 `langgraph`。
- `legacy` 只用于回滚，不允许自动回退。
- 两条链路不得同时为同一个 Run 创建 Artifact。

### 收敛阶段

满足以下条件后删除旧链路：

- LangGraph 主链路端到端测试通过。
- Redis / Worker 故障恢复通过。
- 标题和正文污染测试通过。
- SSE 断线恢复通过。
- 连续灰度运行无重复 Artifact。

删除范围：

- Conversation 对旧 `agent-runs` 的调用。
- 任务完成后生成快照事件的逻辑。
- `title = topic` 和标题截取逻辑。
- 默认自动 Demo 回退。

## 分阶段实施

### 阶段 1：基础设施与健康检查

- 启动 Redis/PostgreSQL/MinIO。
- 增加 API、Worker 健康检查。
- 验证 Redis 不可用时不走 legacy。

### 阶段 2：契约和数据库

- 扩展结构化 Agent 输出 schema。
- 新增数据库迁移、repository 和 Outbox。
- 明确 contextVersion 和幂等键。

### 阶段 3：Run 入队主链路

- Conversation Run API 创建 queued Run。
- Dispatcher 入队。
- Worker 读取真实上下文。

### 阶段 4：真实 Agent 节点

- 接入 Brief、Title、Outline、Writer、Image、Review。
- 接入 Clarification 和 Revision。
- 每个节点保存 AgentTask 和 AgentOutput。

### 阶段 5：Artifact Guard

- 建立标题来源、提示词污染和过程文本检查。
- 建立幂等 ArticleVersion。

### 阶段 6：实时事件与前端

- 实现 PostgreSQL 回放 + Redis 通知 SSE。
- 任务卡显示真实阶段。
- Clarification 恢复和刷新恢复。

### 阶段 7：灰度与旧链路删除

- 使用 feature flag 灰度。
- 采集节点耗时、成本、失败率和 Revision 次数。
- 达标后删除 legacy。

## 验收标准

- Redis 由 Docker Compose 启动并返回 `PONG`。
- `POST /runs` 在 Worker 执行前返回 `queued`。
- BullMQ Job 能被独立 Worker 消费。
- Worker 能读取当前 Conversation 的消息、资源和 Skill。
- RunEvent 在节点执行期间实时产生。
- 前端任务卡显示七个用户可理解阶段。
- Title Agent 输出至少三个候选并自动选择。
- 最终标题不等于用户原始提示词。
- 最终正文不包含用户指令和 AI 过程语言。
- Review 不通过时最多执行两轮 Revision。
- Artifact Builder 校验失败时不创建 ArticleVersion。
- SSE 断线后可从 `Last-Event-ID` 恢复。
- Worker 重试不会重复创建 Artifact。
- Redis 不可用时不静默回退旧生成器。
- 生产环境模型配置缺失时明确失败。

## 文档路由

- 决策：`docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
- 架构：`docs/architecture/overview.md`
- 模块：`docs/modules/creation-graph/README.md`
- Conversation 模块：`docs/modules/conversations/README.md`
- API：`docs/api/creation-graph.md`
- Conversation API：`docs/api/conversations.md`
- 测试方案：`docs/testing/plans/creation-graph.md`
- 测试用例：`docs/testing/cases/creation-graph.md`
- 本地运行：`docs/runbooks/local-dev.md`
- 实施计划：`.plan/20260727-langgraph-multi-agent-production-completion.md`
