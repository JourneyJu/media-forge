# 规格：公众号会话级上下文管理

## 背景

公众号生成工具的核心使用方式是围绕一个创作会话连续生成、补充、修改和复制 HTML。系统不需要跨会话长期记住用户偏好，但需要在同一个 `Conversation` 内稳定管理用户需求、素材、已生成文章和后续修改意见。

当前系统已经具备 `Conversation`、`Run`、`graph_runs.context_json`、`RunEvent`、`AgentOutput` 和 `Artifact`。本规格在现有基础上增加会话级工作记忆，使后续 Run 能基于当前会话状态继续创作，而不是每次从空白 prompt 重新生成。

## 目标

- 只管理当前 `Conversation` 内的会话记忆，不建立跨会话长期记忆。
- 每次 Run 使用冻结上下文快照，保证执行过程可复现。
- 支持继续扩写、修改标题、定向修改指定章节和调整语气等多轮修改。
- 避免把完整历史消息无差别塞入模型上下文。
- 使用模型辅助 Context Rebuild，把历史用户需求重建为结构化任务状态，而不是普通聊天摘要。
- 区分文本上下文和资源上下文：文本可 rebuild；资源原件不可被摘要替代。
- 保持 `Artifact` / `ArticleDocument` 作为最终公众号正文事实源。

## 非目标

- 不做跨会话用户画像或品牌长期知识库。
- 不引入向量检索作为第一阶段依赖。
- 不在第一阶段接入 LangGraph 原生 checkpoint。
- 不把历史对话、Agent 过程或审阅报告直接混入最终正文。
- 不把对象存储或 Redis 作为会话记忆事实源。
- 不把图片、文件或二维码等资源压缩成唯一事实源。
- 不让 Context Rebuild Agent 伪造资源 ID 或跨 Conversation 引用资源。

## 设计原则

1. PostgreSQL 保存会话事实和工作记忆。
2. 原始消息、素材绑定和 Artifact 不可变或只追加。
3. Working Memory 是当前会话的可更新摘要，不替代原始事实。
4. Run 创建时从 Working Memory 生成 `RunContext`，并冻结到 `graph_runs.context_json`。
5. Worker 和 LangGraph 只消费本次 `RunContext`，不直接读取前端临时状态。
6. 每个 Agent 只接收与自身任务相关的上下文片段。
7. 面向模型的上下文与前端展示分离：前端展示完整消息历史，模型只接收结构化上下文、最近少量高价值原文和本轮指令。
8. 资源上下文只保存 `resourceId`、绑定关系、元数据和派生摘要；需要识别图片时必须按 `resourceId` 读取原始资源或预览资源。

## 上下文分层

```text
Raw Layer
  Conversation、Message、Resource、Artifact 等原始事实。

Working Memory
  当前会话的创作状态摘要，可随用户 Turn 和 Run 结果更新。

Context Rebuild
  基于 Raw Layer 和已有 Working Memory 重建下一轮创作所需的结构化任务状态。

Run Context
  本次 Run 的冻结执行快照，保存在 graph_runs.context_json。

Prompt Context
  每个 Agent 调模型前从 Run Context 裁剪出的实际输入。
```

## 总体流程

```mermaid
flowchart TD
  User["用户输入或上传素材"] --> Raw["Raw Layer: messages / resources / artifacts"]
  Raw --> Rebuild["Context Rebuild Agent"]
  Rebuild --> Memory["ConversationWorkingMemory"]
  Memory --> RunContext["CreationRunContext: frozen snapshot"]
  RunContext --> Worker["Worker"]
  Worker --> Graph["LangGraph 多 Agent"]
  Graph --> Outputs["AgentOutput / RunEvent"]
  Graph --> Artifact["Artifact / ArticleDocument"]
  Outputs --> UpdateMemory["Memory Updater"]
  Artifact --> UpdateMemory
  UpdateMemory --> Memory
```

## Raw Layer

Raw Layer 使用现有事实数据：

```text
conversations
conversation_messages
resources
message_resources
runs
agent_outputs
artifacts
```

Raw Layer 的职责：

- 保存用户完整输入和 Assistant 可见消息。
- 保存资源绑定关系和对象存储引用。
- 保存每次 Run 的结构化输出与最终 Artifact。
- 支持排查、回放和重新构建 Working Memory。

Raw Layer 不直接整体进入模型上下文。

## Context Rebuild

Context Rebuild 是创建 Run 前的上下文重建步骤，目标是为下一轮创作重建“任务状态”，不是普通聊天摘要。

输入来源：

- 当前 Conversation 内的用户消息原文。
- Assistant 可见结果摘要。
- 当前和历史资源的 `resourceId`、文件名、类型、绑定消息和已有素材摘要。
- 最新 Artifact 的结构化摘要和已使用资源引用。
- 当前 Turn 的 `creationMode`、`currentInstruction`、`currentResourceIds` 和用户显式继承资源。

输出应为结构化 JSON，并通过契约校验：

```ts
interface ConversationInstructionMemory {
  rebuiltContext?: {
    taskGoal?: string;
    sourceRequest?: string;
    audience?: string;
    styleConstraints: string[];
    contentRequirements: string[];
    prohibitedContent: string[];
    unresolvedQuestions: string[];
    confidence: "high" | "medium" | "low";
  };
  recentValuableTurns: Array<{
    messageId: string;
    content: string;
    reason: string;
  }>;
}
```

规则：

- `rebuiltContext` 用模型生成，失败时允许降级为规则摘要。
- `recentValuableTurns` 默认保留最近 1 到 2 条有价值用户原文；“继续任务”“往下写”“好的”等短确认不占名额。
- `currentInstruction` 永远单独保留，用于表达本轮意图。
- `new` 模式只基于本轮消息和本轮资源重建，不继承旧主题文本。
- `continue` 和 `revise` 模式可以继承 `sourceRequest`、用户约束和最近高价值原文。
- Rebuild 结果不得包含系统 prompt、开发者指令、模型思维链、Agent 内部报告或未脱敏 raw output。

## 资源上下文

资源上下文不参与文本压缩。原始资源始终由 `resources` 表和 MinIO / S3 对象保存，`ConversationWorkingMemory` 只保存资源索引、绑定关系和可派生摘要。

```ts
interface ConversationResourceContext {
  currentResourceIds: string[];
  inheritedResourceIds: string[];
  artifactResourceIds: string[];
  materialSummary: Array<{
    resourceId: string;
    type: "image" | "document" | "link" | "unknown";
    originalName?: string;
    contentType?: string;
    sourceMessageId?: string;
    description?: string;
    ocrText?: string;
    suggestedUsage?: string;
    quality?: "high" | "medium" | "low";
  }>;
}
```

资源规则：

- `currentResourceIds` 是本轮上传或本轮显式选择的资源。
- `inheritedResourceIds` 必须来自用户显式选择或明确指令，例如“继续用刚才那几张图”。
- `artifactResourceIds` 来自上一版 Artifact 已经使用的资源，修改类任务可按 `lastArtifactId` 找回。
- `materialSummary` 是派生摘要，不替代原始资源；需要看图时由 Material / Vision Agent 按 `resourceId` 读取原图或预览。
- Context Rebuild Agent 只能引用已有 `resourceId`，不能创造资源事实。
- 新主题默认不继承历史资源；历史资源必须显式继承。

## Working Memory

Working Memory 是当前会话的工作状态摘要。建议新增 `conversation_memories` 表保存。

```ts
interface ConversationWorkingMemory {
  conversationId: string;
  contextVersion: number;
  instructionMemory: ConversationInstructionMemory;
  brief?: CreativeBrief;
  selectedTitle?: {
    id: string;
    title: string;
    subtitle?: string;
    angle?: string;
  };
  outline?: {
    title: string;
    subtitle?: string;
    sectionTitles: string[];
    openingHook?: string;
    callToAction?: string;
  };
  draftSummary?: {
    artifactId?: string;
    title: string;
    paragraphCount: number;
    sectionTitles: string[];
    keyPoints: string[];
    tone?: string;
    audience?: string;
  };
  resourceContext: ConversationResourceContext;
  userConstraints: string[];
  revisionIntent?: {
    target?: "title" | "outline" | "body" | "image" | "style" | "all";
    instruction: string;
    createdAt: string;
  };
  lastArtifactId?: string;
  updatedAt: string;
}
```

Working Memory 的更新来源：

- 用户新 Turn 中明确表达的约束和修改意图。
- Context Rebuild Agent 输出的结构化文本任务状态。
- Run 完成后的 `CreativeBrief`、标题、提纲、草稿摘要、配图计划和 Artifact。
- Clarification 提交后的补充信息。
- 素材理解结果或资源摘要。

## Run Context

`CreationRunContext` 由 Service 在创建 Run 时生成，并冻结到 `graph_runs.context_json`。

```ts
interface CreationRunContext {
  currentInstruction: string;
  instructionMemory: ConversationInstructionMemory;
  resourceContext: ConversationResourceContext;
  skillId: string;
  maxSteps: number;
  contextVersion: number;
  memory: {
    brief?: CreativeBrief;
    selectedTitle?: ConversationWorkingMemory["selectedTitle"];
    outline?: ConversationWorkingMemory["outline"];
    draftSummary?: ConversationWorkingMemory["draftSummary"];
    userConstraints: string[];
    lastArtifactId?: string;
    revisionIntent?: ConversationWorkingMemory["revisionIntent"];
  };
}
```

规则：

- 同一个 Run 只读取自己的 `context_json`。
- 用户在 Run 执行期间继续发送消息，不改变已经创建的 Run。
- 追问补充会递增 `contextVersion`，更新 `context_json` 后重新入队。
- 如果是修改类请求，Run Context 应包含 `lastArtifactId`，必要时 Worker 可按该 ID 读取上一版 `ArticleDocument`。
- `currentInstruction`、`instructionMemory` 和 `resourceContext` 必须分开传递，禁止把历史用户消息直接拼接成一条长 prompt。
- 资源 ID 必须来自当前 Conversation 的 Resource 或当前 Artifact 引用，不能跨 Conversation。

## Prompt Context

每个 Agent 从 `RunContext` 中选择必要字段，不接收完整历史。

| Agent | 主要上下文 |
| --- | --- |
| Context Rebuild Agent | 当前 Conversation 内用户消息、资源索引、素材摘要、Artifact 摘要、本轮指令 |
| Brief Agent | currentInstruction、instructionMemory、历史 brief 摘要、用户约束、resourceContext.materialSummary |
| Title Agent | brief、用户约束、上一版标题或修改意图 |
| Outline Agent | brief、selectedTitle、上一版 outline 或结构修改意图 |
| Writer Agent | brief、selectedTitle、outline、修改任务中的上一版 ArticleDocument |
| Image Planner Agent | outline、resourceContext、必要时读取原始资源或预览 |
| Reviewer Agent | draft、brief、userConstraints、imagePlan |
| Revision Agent | draft、reviewReport、revisionIntent、上一版 Artifact 上下文 |

## Turn 意图

创建 Run 前需要识别当前用户 Turn 的意图。

```ts
type TurnIntent =
  | "new_creation"
  | "revise_existing"
  | "continue_existing"
  | "clarification_answer";
```

第一阶段可使用规则判断：

- 包含“改、调整、换、优化、加、删、重写标题”等动词时，优先判定为 `revise_existing`。
- 当前会话已有 `lastArtifactId` 且用户输入较短时，优先判定为 `revise_existing` 或 `continue_existing`。
- 明确出现“重新生成一篇、新主题、换一个主题”时，判定为 `new_creation`。
- Run 处于 `waiting_clarification` 且提交追问答案时，判定为 `clarification_answer`。

质量重构后的约束：

- 意图识别只读取最新 Turn，不读取拼接后的多条历史用户消息。
- 前端可发送 `creationMode=auto|new|revise|continue`；显式值优先于服务端推断。
- `new_creation` 清空旧 brief、标题、outline、draft summary、LayoutPlan 和 `lastArtifactId`。
- `new_creation` 默认只使用本轮资源；历史资源必须由用户显式选择后继承。
- `revise_existing` 才允许读取上一版 ArticleDocument 和与修改目标相关的历史状态。
- `continue_existing` 使用 `instructionMemory.rebuiltContext` 和最近高价值原文恢复创作目标，同时保留本轮短指令。
- `revise_existing` 可以继承上一版 Artifact 使用的资源，但不能自动继承会话内全部历史资源。

完整目标契约见 `docs/specs/015-multi-agent-content-and-layout-quality.md`。

## 数据库建议

第一阶段新增：

```sql
create table conversation_memories (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  context_version integer not null,
  memory_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

可选二阶段新增：

```sql
create table conversation_memory_versions (
  id uuid primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  context_version integer not null,
  memory_json jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
```

`conversation_memory_versions` 仅用于调试和审计，第一阶段不是必需项。

## 多轮修改流程

```mermaid
sequenceDiagram
  participant User
  participant Web
  participant Service
  participant DB
  participant Worker
  participant Graph

  User->>Web: 把语气改温暖一点
  Web->>Service: POST /conversations/:id/turns
  Service->>DB: 追加 conversation_messages
  Service->>DB: 读取 ConversationWorkingMemory
  Service->>DB: 读取消息、资源索引和 latest Artifact 摘要
  Service->>Graph: Context Rebuild（可降级为规则摘要）
  Service->>DB: 读取 latest Artifact
  Service->>DB: 创建 Run 和 graph_runs.context_json
  Service->>DB: 写 run_dispatch_outbox
  Worker->>DB: 读取 RunContext
  Worker->>Graph: 执行 LangGraph
  Graph->>DB: 写 AgentTask / AgentOutput / RunEvent
  Worker->>DB: 保存 Artifact
  Worker->>DB: 更新 ConversationWorkingMemory
  Web->>Service: 订阅 RunEvent
  Web->>Service: GET Artifact
```

## 上下文裁剪策略

目标方案采用分层裁剪策略：

- 最新用户输入以 `currentInstruction` 完整保留。
- 旧文本需求由 Context Rebuild Agent 重建为结构化 `instructionMemory.rebuiltContext`。
- 最近 1 到 2 条有价值用户原文保留在 `instructionMemory.recentValuableTurns`。
- 修改任务按 `lastArtifactId` 读取上一版结构化正文。
- 资源只传 `resourceContext` 中的 ID、元数据和派生摘要；原始资源需要时由对应 Agent 按 ID 读取。
- 每个 Agent 只读取自身需要的上下文片段。

禁止：

- 全量历史消息拼接给所有 Agent。
- 用资源摘要替代原始资源事实源。
- Context Rebuild Agent 伪造 resourceId、图片内容或 OCR。
- 把 Agent 执行过程、审阅报告或系统 prompt 写入最终正文。
- 在不同 Conversation 之间共享 Working Memory。

## 与现有模块关系

- `conversations` 负责 Working Memory 的生命周期、Run 创建前的上下文组装、Conversation 删除级联清理。
- `creation-graph` 负责消费冻结的 `RunContext`，并在 Run 完成后输出可用于更新 Working Memory 的结构化结果。
- `assets` 负责资源原件、元数据和素材摘要来源；资源摘要不替代原件。
- `artifacts` 仍是最终公众号正文事实源。

## 第一阶段实施范围

1. 增加 `ConversationInstructionMemory`、`ConversationResourceContext` 和 `CreationRunContext` 契约。
2. 在现有 `conversation_memories.memory_json` 中保存结构化上下文，第一阶段不新增表。
3. 创建 Run 时运行 Context Rebuild；模型失败时使用规则 fallback。
4. 创建 Run 时冻结 `currentInstruction`、`instructionMemory`、`resourceContext`、`lastArtifactId` 到 `graph_runs.context_json`。
5. Agent 按职责读取上下文片段，Brief / Planner 不再只依赖最新短指令。
6. Run 完成后用 AgentOutput、Artifact 和资源使用结果更新 Working Memory。
7. Clarification 提交后更新 `contextVersion`、`context_json` 和 Working Memory。

## 后续阶段

- 将规则 fallback 升级为模型辅助 Context Rebuild，并增加输出质量评分。
- 接入素材理解摘要，完善 `resourceContext.materialSummary`。
- 增加上下文调试视图，展示本次 Run 实际使用的上下文摘要。
- 按模型 `contextWindow` 增加 token budget 裁剪。
- 必要时增加 `conversation_memory_versions`。
- LangGraph 原生 checkpoint 仍作为执行恢复增强，不作为业务上下文事实源。

## 验收标准

- 第一轮生成公众号文章后，Working Memory 写入 brief、标题、提纲摘要、正文摘要和 `lastArtifactId`。
- 用户说“标题更吸引人一点”时，系统基于上一版文章修改，不重新空写。
- 用户要求修改指定章节时，系统能读取上一版结构化正文并定向修改。
- 用户首轮输入长 prompt，后续只说“继续任务”时，RunContext 仍保留原始创作目标、约束和最近有价值原文。
- 图片、二维码、海报等资源原件仍从 Resource / 对象存储读取；`materialSummary` 缺失或错误时可重新按 `resourceId` 识别。
- 新主题不会自动继承旧资源；继续或修改任务只能继承显式选择资源或上一版 Artifact 已使用资源。
- 刷新页面后继续会话，Working Memory 不丢失。
- 新建 Conversation 不继承旧 Conversation 的记忆。
- RunContext 创建后保持冻结，不受后续用户消息影响。
- 最终正文不包含内部上下文、Agent 过程、审阅报告或用户原始长 prompt。
