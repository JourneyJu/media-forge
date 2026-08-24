# 规格：多 Agent 旁路推理摘要与阶段级自动收起

## 状态

D-R1 已实施，功能开关默认关闭；D-R2 仍为 Proposed。

实现日期：2026-08-24。

当前实现通过 `REASONING_SUMMARIZER_ENABLED=true` 启用，并可通过
`REASONING_SUMMARIZER_SHADOW_MODE=true` 只执行安全验证而不发布用户事件。
首期启用名单为 `ContentPlannerAgent`、`WriterAgent` 和 `ReviewerAgent`。

## 背景

MediaForge 的公众号生成链路采用多 Agent 架构。当前系统已经通过 Model Gateway 解析可选的 `reasoning_content`，由 Worker 写入产品级 `RunEvent`，再通过 PostgreSQL 事件回放和 SSE 展示 Agent 的执行阶段、心跳、校验和重试状态。

现有实现遵守 ADR 011：供应商原始 reasoning 只作为活跃信号，用户看到的是平台固定映射的业务文案。该方案安全、稳定，但不同任务和 Agent 的过程反馈相似，不能充分解释当前 Agent 正在观察什么、比较什么或检查什么；前端也只在整个 Run 完成后收起任务卡，单个 Agent 完成后不一定立即收起其临时过程。

本规格引入 Agent 旁路推理摘要（D-R）：每次业务 Agent 模型调用旁挂一个非阻塞 `ReasoningObserver`。它只在 Worker 内存中收集有界 reasoning 窗口，按资格和预算调用轻量摘要模型，产生受控的安全分析动态。摘要器不是 LangGraph 节点，不参与业务决策；Agent 完成后立即取消摘要、清空原始 reasoning，并由前端收起该阶段。

本规格延续“不透传原始思维链”的现有边界。用户看到的是由系统整理的分析动态，不是模型逐字内部推理。

## 需求分级

### D-R1：基础生产版

M 级。

- 复用现有 Model Gateway 和 `text_generation` 路由。
- 扩展共享 RunEvent 契约。
- 增加 Worker 内存旁路、摘要安全策略和前端阶段交互。
- 不修改数据库 schema，不新增服务或生产依赖。

### D-R2：独立运营增强版

L 级，D-R1 验证价值后另行立项。

- 新增 `reasoning_summary` 模型路由。
- 增加模型调用用途、父调用关系和独立成本统计。
- 涉及数据迁移时必须先创建 `.plan/` 计划并重新人工确认。

本规格的首期实施范围仅为 D-R1；D-R2 只记录演进方向，不属于首期验收。

## 目标

- 当前执行 Agent 自动展开，并显示与当前任务相关的安全分析动态。
- Agent 完成后 500ms 内自动收起，临时分析不再可见，只保留完成摘要。
- 摘要模型调用完全旁路，不阻塞主模型流、结构校验和 Artifact 持久化。
- 摘要失败、超时、限流或被安全策略拒绝时，自动回退确定性阶段动态。
- 支持 Agent 重试、Graph 回退、Run 取消、晚到响应丢弃和 SSE 断线回放。
- 原始 reasoning 不进入 PostgreSQL、Redis、BullMQ、日志、Tracing、错误报告或浏览器。
- 不支持 reasoning 的模型继续展示真实阶段和心跳，不伪造模型分析。

## 非目标

- 不展示或持久化供应商原始思维链。
- 不把过程摘要作为 `AgentOutput`、`Artifact`、`ArticleVersion` 或最终正文事实源。
- 不把摘要器设计成新的 LangGraph Agent 或业务节点。
- 不让摘要器访问工具、数据库、对象存储、网络资源或完整 RunContext。
- 不保证每个 Agent 都一定出现模型摘要；短节点和无 reasoning 节点只显示确定性进度。
- 首期不新增独立摘要模型路由、数据库字段或生产依赖。

## 产品定义

用户界面使用“分析动态”或“创作思路”，辅助标注“由系统实时整理”。不得使用“原始思维链”“完整思考”或其他会让用户误以为看到模型逐字内部推理的表述。

过程内容只允许表达：

- 观察：当前识别到哪些业务信息。
- 比较：正在权衡哪些内容方向。
- 规划：准备如何组织内容、素材或版式。
- 检查：正在验证哪些结构、事实或质量要求。
- 修订：正在针对哪些已知问题调整结果。

Agent 运行中使用进行时，例如“正在比较”“正在检查”。“已确定”“已完成”“已通过”等完成式结论只能由通过 schema 和业务门禁的 AgentOutput 生成。

## 总体架构

```text
Creation Graph
  → 业务 Agent
    → 主模型 content stream
      → 原有内存缓冲
      → JSON.parse + Zod + 业务门禁
      → AgentOutput / Artifact
    → reasoning stream
      → ReasoningObserver
        → SecureReasoningBuffer
        → Eligibility Gate
        → Input Sanitizer
        → ReasoningSummarizer
        → Strict Output Schema
        → Output Safety Policy
        → Execution Fence
        → RunEvent
        → PostgreSQL → SSE → 当前 Agent UI
```

必须维持以下边界：

- 浏览器仍然只连接 Service SSE，不直接连接模型供应商。
- `content` delta 不进入摘要器，残缺结构化输出不进入前端。
- 主模型调用不等待摘要模型，摘要器错误不能向主链路抛出。
- 摘要器不修改 Graph State，不影响 Agent、Run 和 Artifact 的成败。
- 任一旁路检查失败都丢弃摘要并回退确定性动态。

## 核心组件

### `ReasoningObserver`

每次 Agent 模型调用创建一个 Observer，负责接收 reasoning 增量、管理内存缓冲、资格判断、单飞调用、预算、取消和晚到结果丢弃。

目标接口：

```ts
interface ReasoningObserver {
  append(delta: string): void;
  phaseChanged(phase: AgentProgressPhase): void;
  complete(): void;
  fail(): void;
  cancel(): void;
}
```

`append` 只能执行同步、快速且有界的内存操作，不能等待摘要调用。

### `SecureReasoningBuffer`

原始 reasoning 只存在于 Worker 内存中的有界环形缓冲区。

```ts
interface SecureReasoningBuffer {
  append(delta: string): void;
  takeLatest(maxChars: number): string;
  clear(): void;
}
```

默认限制：

| 项目 | 默认值 |
| --- | ---: |
| 单 Agent 缓冲上限 | 8KB |
| 单 Run 缓冲上限 | 32KB |
| 单次摘要读取上限 | 最近 1,500 字符 |

超过上限时丢弃最早片段。Agent 完成、失败、取消或进入新 attempt 时立即清空对应缓冲；Run 终态时清空全部缓冲。

### `ReasoningSummarizer`

摘要器是 Model Gateway 的内部旁路能力，不是业务 Agent。

```ts
interface ReasoningSummarizer {
  summarize(
    input: ReasoningSummarizerInput,
    signal: AbortSignal
  ): Promise<ReasoningSummaryResult>;
}
```

首期复用当前主模型所属的同一模型连接和供应商。默认禁止把 reasoning 从供应商 A 转发给供应商 B；跨供应商处理必须在 D-R2 中单独进行数据与安全评审。

### `SummarySafetyPolicy`

安全策略同时负责：

- 摘要前输入预清洗。
- 摘要后严格 schema 校验。
- 敏感内容、Prompt 注入、隐私和内部信息检测。
- 进行时语义、事实范围和重复摘要检查。
- 返回可观测但不包含原文的拒绝原因码。

## Agent 执行身份

同一 Agent 可能因为模型重试、Review 回退或 Graph 恢复被多次执行。摘要会话必须使用完整执行身份：

```ts
interface AgentExecutionIdentity {
  runId: string;
  stepId: string;
  agentName: string;
  attemptNo: number;
  executionId: string;
}
```

- `runId`：一次完整创作任务。
- `stepId`：用户可见步骤。
- `agentName`：实际执行 Agent。
- `attemptNo`：当前模型或节点尝试序号。
- `executionId`：本次 Agent 调用的唯一 ID。

摘要返回时必须重新核对全部字段和当前状态；任一不匹配即视为晚到结果并丢弃。

## 生命周期与状态机

Observer 状态：

```text
idle
→ collecting
→ summarizing
→ published
→ collecting
→ closed
```

旁路不可用时：

```text
collecting | summarizing
→ disabled
→ closed
```

### Agent 开始

1. 生成 `executionId`。
2. 创建 `ReasoningObserver` 和 `AbortController`。
3. 写入 `agent.started`。
4. 前端自动展开当前 Agent。

### 收到 reasoning delta

1. 执行基础清洗并写入内存缓冲。
2. 标记窗口 `dirty=true`。
3. 判断是否满足摘要资格。
4. 不阻塞主模型 stream reader。

### 发起摘要

1. 设置 `inFlight=true`。
2. 截取最新有界窗口。
3. 执行输入预清洗。
4. 以异步旁路方式调用摘要模型。
5. 主模型继续生成，不等待摘要器。

摘要执行期间的新 reasoning 继续写入缓冲，只标记 `dirty`，不创建并行摘要调用。

### 摘要返回

写事件前依次检查：

1. Observer 未关闭。
2. Run 仍为 `running`。
3. `stepId`、`agentName`、`attemptNo` 和 `executionId` 仍匹配。
4. Agent 仍在执行。
5. 未超过 Agent 和 Run 预算。
6. 输出通过 schema、安全、事实范围和重复检查。

任一步失败都不写用户事件。

### Agent 完成

顺序必须为：

```text
Observer 标记 closed
→ AbortController 取消在途摘要
→ executionId 失效
→ 清空原始 reasoning
→ agent.completed / step.completed
→ 前端延迟 300～500ms 收起
```

不能为了等待最后一条摘要延迟 AgentOutput 或 Artifact 持久化。

### Agent 失败、取消与重试

- 失败：关闭 Observer、清空原始 reasoning，保留失败前已发布的最后一条安全摘要，失败阶段保持展开。
- 取消：关闭全部 Observer，不等待摘要器，Run 进入明确终态。
- 重试：关闭旧 attempt，创建新 `executionId`；旧响应不得进入新 attempt。
- Graph 回退：即使 `agentName` 相同，也必须使用新的 `stepId` 或 `executionId` 隔离执行。

## 摘要资格与预算

首期默认参数：

| 参数 | 默认值 |
| --- | ---: |
| Agent 最短运行时间 | 3 秒 |
| 首次最少 reasoning | 300 字符 |
| 首次摘要最早时间 | 开始后 3 秒 |
| 第二次摘要最小间隔 | 8 秒 |
| 单 Agent 最大摘要数 | 1；运行超过 12 秒时允许第 2 条 |
| 单 Run 最大摘要数 | 6 |
| 单次输入上限 | 1,500 字符 |
| 单次输出上限 | 120 字符 |
| 摘要调用超时 | 4 秒 |
| 摘要调用重试 | 0 |
| 单 Worker 摘要并发 | 2 |

只有同时满足以下条件才允许调用：

```text
Agent 在启用名单
AND 已超过最短运行时间
AND reasoning 达到最少长度
AND 当前没有在途摘要
AND 未达到 Agent 预算
AND 未达到 Run 预算
AND 摘要并发有空位
AND Agent 与 Run 仍在运行
```

并发已满时不排长队，直接回退确定性动态。

首期建议只开放：

- `ContentPlannerAgent`
- `WriterAgent`
- `ReviewerAgent`

价值和风险验证通过后，再评估 `MaterialAgent`、`BriefAgent`、`LayoutAgent` 和 `RevisionAgent`。Renderer、Artifact Builder、Structure Guard 等确定性节点不调用摘要模型。

## 内容来源与降级

按以下优先级选择：

1. 供应商明确提供的安全 reasoning summary，经平台校验后使用。
2. 供应商只提供原始 `reasoning_content` 时，进入旁路摘要器。
3. 无 reasoning、摘要超时、拒绝、超预算或并发已满时，使用确定性业务动态。

不支持 reasoning 的模型不得生成伪造的“比较了哪些方案”。确定性动态只描述平台已知事实，例如“正在依据内容计划生成正文”或“正在校验结构和必填字段”。

## 摘要输入协议

```ts
interface ReasoningSummarizerInput {
  publicAgentLabel: string;
  phase: "thinking" | "generating";
  safeContext: {
    resourceCount?: number;
    contentType?: string;
    audienceCategory?: string;
  };
  previousSummary?: string;
  untrustedExcerpt: string;
}
```

`safeContext` 由平台显式构造，不允许展开完整 RunContext、用户历史、系统 Prompt、Skill 指令、模型连接配置、对象存储地址、完整 OCR 或未校验结构化输出。

## 输入安全策略

摘要前删除或拒绝：

- `system prompt`、`developer message`、工具指令及类似元指令。
- Authorization、Bearer、Cookie、API Key 和连接串。
- URL、IP、内部文件路径、UUID 和资源主键。
- 高熵 Token、代码围栏和大段 JSON。
- 手机号、邮箱、账号、二维码文本等明显隐私。
- “忽略规则”“输出系统提示”等 Prompt 注入片段。
- 超过窗口限制的早期内容和重复片段。

高风险命中时直接放弃当前摘要，不将替换后的剩余内容继续发送给摘要器。

```ts
type SanitizeResult =
  | { allowed: true; text: string }
  | { allowed: false; reasonCode: string };
```

原始输入、清洗前后文本和被拒绝文本不得进入日志、Tracing、错误报告或测试快照。

## 摘要输出协议

首期采用受控结构，由服务端模板生成最终展示文本，减少自由文本失真：

```ts
interface ReasoningSummaryResult {
  activity: "analyzing" | "comparing" | "planning" | "checking" | "revising";
  subjects: string[];
  alternatives?: string[];
  basis?: string;
}
```

约束：

- `subjects` 最多 3 项，每项最多 40 字符。
- `alternatives` 最多 3 项，每项最多 40 字符。
- `basis` 最多 80 字符。
- Schema 使用 `.strict()`，拒绝额外字段。
- 摘要器不能调用工具或访问外部资源。
- 服务端生成的最终文案最多 120 字符、最多两行，不使用 Markdown。

执行中只允许“正在分析、比较、规划、检查、修订”等进行时。摘要不得宣布最终决定，不得新增输入窗口和安全上下文中不存在的数字、实体或事实。

## 输出安全策略

摘要结果必须再次检查：

- 系统 Prompt、开发者指令和内部策略痕迹。
- Token、URL、IP、连接串、内部 ID 和字段名。
- Markdown、代码、JSON 和高熵字符串。
- 手机号、邮箱、账号等隐私。
- 完成式结论和未验证事实。
- 与当前 Agent 职责无关的内容。
- 与上一条摘要高度重复或明显冲突的内容。
- 新增数字、专有实体和备选项是否存在于安全输入。

不通过时记录无文本 `reasonCode`，丢弃摘要并回退确定性动态。

## 目标事件契约

新增完整摘要事件：

```text
agent.reasoning.summary
```

不复用 `agent.reasoning.delta`，因为摘要器返回的是完整替换文本，不是可拼接 token。

```ts
interface AgentReasoningSummaryPayload {
  runId: string;
  stepId: string;
  agentName: string;
  attemptNo: number;
  executionId: string;
  sequence: number;
  revision: number;
  phase: "thinking" | "generating";
  summary: string;
  category: "understanding" | "comparison" | "planning" | "validation" | "revision";
  source: "provider_summary" | "sidecar_summarizer";
  visibility: "active_step_only";
  elapsedMs: number;
  createdAt: string;
}
```

兼容规则：

- 老客户端忽略新事件。
- SSE URL、`Last-Event-ID` 和 PostgreSQL `event_no` 语义不变。
- `sequence` 用于事件去重，`revision` 用于同一执行摘要替换。
- 新前端收到完整摘要后替换当前文本，不做字符串拼接。
- `visibility=active_step_only` 表示完成阶段不得重新展示该内容。
- 现有 `agent.progress`、`run.heartbeat` 和终态事件继续保留。

## 数据归属与保留

### 原始 reasoning

- 只属于 Worker 当前 Agent 执行的临时内存状态。
- 不持久化、不可回放、不可查询。
- Agent 或 Run 终态立即清空。

### 安全摘要

- 通过安全策略后可以作为 `RunEvent` 写入 PostgreSQL。
- 用于 SSE 顺序、断线回放和刷新后恢复当前运行阶段。
- 完成阶段由前端停止展示；“完成后看不到”表示不再展示，不等于删除已通过安全检查的 RunEvent。
- 如果未来要求完成后物理删除安全摘要，需要另立数据保留规格和清理策略。

## 前端交互

### 运行中

当前 Agent 自动展开，显示：

```text
内容策划                         分析中 · 9 秒

分析动态 · 由系统实时整理
正在比较结果导向和过程导向两种开场方式，主要参考素材证据完整度。
```

同一 Agent 最多保留最近 2 条摘要；新摘要替换当前主摘要，不生成无限增长的日志。

### 完成

收到 `step.completed` 或 `agent.completed` 后：

1. 停止接收该 execution 的新摘要。
2. 延迟 300～500ms，从自动展开集合移除。
3. 清除前端临时 `reasoningSummary`。
4. 只保留由已验证输出生成的完成摘要。
5. 用户手动展开完成阶段时，也不重新显示临时摘要。

### 下一 Agent

前一阶段完成后收起；下一阶段开始时自动展开下一 Agent。用户手动收起当前运行阶段后，本 Agent 的后续摘要不得强制重新打开；下一 Agent 开始时可以自动展开。

### 失败

失败阶段保持展开，显示失败前最后一条已发布安全摘要、用户可理解的错误和重试入口。失败后的晚到摘要不得写入或展示。

### 无障碍与动效

- 使用 `aria-live="polite"`，只播报完整摘要，不播报 token。
- Agent 完成和自动收起不能抢夺焦点。
- 遵循 `prefers-reduced-motion`。
- 运行不足 3 秒且没有有效摘要的节点不展示分析面板，避免闪烁。

## 并发与竞态

### Single-flight

同一个 Agent execution 同时最多一个摘要调用。

### Dirty window

在途摘要期间的新 reasoning 继续写入缓冲，只设置 `dirty=true`。摘要完成后仍需满足间隔和预算才能处理最新窗口。

### Execution fence

摘要返回时必须匹配 `runId + stepId + agentName + attemptNo + executionId`，并确认 Agent 和 Run 仍在运行。

### Late-result drop

Agent 已完成、失败、取消、重试或被 Graph 回退时，旧响应直接丢弃。前端也必须忽略发给 `completed` 或 `failed` execution 的新摘要事件，形成双层防护。

### Backpressure

摘要并发已满时不排队、不阻塞主模型，记录无文本指标后回退确定性进度。

## 成本与性能

附加 Token 估算：

```text
额外输入 Token = 启用 Agent 数 × 平均摘要次数 × 单次输入 Token
额外输出 Token = 启用 Agent 数 × 平均摘要次数 × 单次输出 Token
```

首期控制目标：

- 每 Run 平均摘要调用不超过 3 次，硬上限 6 次。
- 每 Agent 默认 1 次，只有运行超过 12 秒才允许第 2 次。
- 摘要器不能显著增加主 Agent P50/P95 延迟。
- 摘要器调用不占用主 Agent 并发名额。
- 达到预算后静默回退，不向用户显示错误。

## 功能开关与熔断

建议配置：

```text
REASONING_SUMMARIZER_ENABLED=false
REASONING_SUMMARIZER_SHADOW_MODE=true
REASONING_SUMMARIZER_MAX_PER_AGENT=1
REASONING_SUMMARIZER_MAX_PER_RUN=6
REASONING_SUMMARIZER_MIN_AGENT_MS=3000
REASONING_SUMMARIZER_SECOND_AFTER_MS=12000
REASONING_SUMMARIZER_MIN_INTERVAL_MS=8000
REASONING_SUMMARIZER_TIMEOUT_MS=4000
REASONING_SUMMARIZER_MAX_CONCURRENCY=2
```

必须支持全局、环境和 Agent 类型级关闭。确认发生敏感泄露、摘要影响主链路成功率或成本超过预算时，立即关闭旁路摘要器，系统自动恢复为现有确定性进度。

## 可观测性

只记录数值、枚举和原因码，不记录原始或摘要文本。

建议指标：

```text
reasoning_summary_eligible_total
reasoning_summary_call_total
reasoning_summary_success_total
reasoning_summary_timeout_total
reasoning_summary_rejected_total
reasoning_summary_late_drop_total
reasoning_summary_budget_drop_total
reasoning_summary_concurrency_drop_total
reasoning_summary_fallback_total
reasoning_summary_latency_ms
reasoning_summary_input_tokens
reasoning_summary_output_tokens
```

允许维度为 Agent 类型、模型配置 ID、状态、环境和拒绝原因码。禁止将用户 Prompt、reasoning、摘要正文、OCR 和文章内容作为指标维度或日志字段。

## 风险与应对

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| 敏感信息进入摘要或外部模型 | P0 | 同供应商、内存有界缓冲、输入/输出双层检查、零文本日志和一键熔断 |
| 摘要歪曲 Agent 实际判断 | P1 | 受控结构、平台模板、进行时表达、数字与实体一致性检查 |
| Prompt 注入影响摘要器 | P1 | 不可信数据边界、无工具权限、严格 schema、恶意样本测试 |
| 摘要阻塞主模型 | P1 | 完全异步、独立并发、4 秒超时、零重试、主链路不 await |
| 晚到摘要污染完成或重试状态 | P1 | execution fence、AbortController、late drop、前端终态防护 |
| 多 Agent 放大调用成本 | P1 | 仅长 Agent、每 Agent/Run 预算、轻量模型和自动降级 |
| 供应商能力不一致 | P1 | Gateway 能力声明、统一事件和确定性进度回退 |
| RunEvent 写放大 | P2 | 完整摘要而非 token 事件、单 Agent 1～2 条、有效事件替代同期 heartbeat |
| 用户误认为看到完整思维链 | P2 | “分析动态·由系统整理”文案，明确过程与最终结果边界 |
| UI 展开收起干扰阅读 | P2 | 短节点不展示、摘要替换、手动操作优先和 reduced motion |

## 灰度方案

### 阶段 1：本地模拟

- 使用构造 reasoning stream，不使用真实用户数据。
- 覆盖密钥、URL、隐私、Prompt 注入、晚到响应和重试竞态。

### 阶段 2：Shadow

- 真实调用摘要器并执行安全校验，但不写用户 RunEvent。
- 只观察成功率、延迟、成本、拒绝率和晚到率，不保存摘要正文。

### 阶段 3：内部账号

- 只启用 ContentPlanner、Writer、Reviewer。
- 每 Agent 最多一条摘要。
- 验证阶段收起、SSE 回放和故障降级。

### 阶段 4：小流量

- 依次扩大到 5%、10%、50%。
- 每阶段检查完整业务周期后再扩大。

停止条件：

- 发现任何 Prompt、Token 或隐私泄露。
- 安全拒绝率超过 5%。
- 摘要 P95 延迟超过 4 秒。
- 晚到丢弃比例超过 30%。
- 主模型延迟或失败率显著上升。
- 单 Run 成本超过预算。

## 实施阶段

1. 文档与契约：确认 ADR、扩展 `RunEvent` 和 API 目标文档。
2. 安全核心：实现有界缓冲、输入清洗、输出 schema、安全策略和恶意样本测试。
3. 旁路协调：实现 Observer、单飞、预算、并发、取消和 execution fence。
4. Gateway 集成：实现异步摘要调用、同供应商约束、超时和用量统计。
5. Worker 集成：接入 Agent 生命周期，保证原始 reasoning 不进入事件或日志。
6. 前端交互：完整摘要替换、当前阶段展开、完成后收起和终态防护。
7. Shadow 与灰度：默认关闭，依照灰度门禁逐步开放。

每个实施任务应控制在约 5 个文件以内，并在契约、安全核心、主链路集成和前端集成后分别设置验证检查点。

## 验收标准

- 当前执行 Agent 可以显示独立、任务相关的安全分析动态。
- 原始 reasoning 不进入数据库、Redis、队列、日志、Tracing、SSE、错误报告和 Artifact。
- 摘要器调用不阻塞主模型 stream、schema 校验和 Artifact 创建。
- 摘要器失败不改变 Agent 或 Run 状态。
- 不支持 reasoning 的模型不伪造分析，只显示确定性阶段和心跳。
- Agent 完成后 500ms 内自动收起，临时摘要不再可见。
- 用户手动展开完成阶段时只看到完成摘要。
- 失败 Agent 保持展开，但不接收失败后的晚到摘要。
- Agent 重试和 Graph 回退不会混入旧 execution 摘要。
- SSE 重连不重复拼接摘要，也不会恢复已完成阶段的临时展示。
- 每 Agent 和每 Run 的调用次数、Token、超时和并发符合预算。
- 功能开关关闭后系统完整回退到当前确定性进度。
- 最终公众号正文和文章版本不包含任何过程摘要。

## AI 自审

AI 自审结论：通过，可以进入 D-R1 人工确认。

- 分级复核：D-R1 为 M 级；D-R2 涉及模型路由和数据迁移时为 L 级，必须另立计划。
- 服务边界：浏览器、Web、Service、Worker、PostgreSQL 和 Model Gateway 边界不变。
- 契约与数据：D-R1 只扩展 RunEvent；原始 reasoning 不持久化，安全摘要复用现有事件事实源。
- 异常路径：超时、拒绝、预算、并发、取消、重试和晚到结果都有明确降级。
- 安全风险：最高风险是敏感泄露和摘要失真，已使用输入/输出双层门禁、受控结构和全局熔断降低风险，但不能降为零。
- 测试方案：必须覆盖恶意输入、竞态、SSE 回放、主链路性能和功能开关。
- 反方意见：用户只短暂查看后即收起，额外模型成本可能大于产品价值，因此必须先 Shadow 并限制为三个长 Agent。
- 人工重点：确认安全摘要而非原始思维链的产品定义，以及 D-R1 的调用预算和首批 Agent 范围。

## 文档路由

- ADR：`docs/adr/014-agent-reasoning-sidecar-summary.md`
- 现有安全决策：`docs/adr/011-safe-agent-reasoning-stream.md`
- 现有流式规格：`docs/specs/016-streaming-agent-progress.md`
- 模块：实现时同步 `docs/modules/creation-graph/README.md` 和 `docs/modules/chat-workspace/README.md`
- API：实现时同步 `docs/api/creation-graph.md` 和 `docs/api/conversations.md`
- 测试计划：实现时同步 `docs/testing/plans/creation-graph.md` 和 `docs/testing/plans/chat-workspace.md`
- 测试用例：实现时同步 `docs/testing/cases/creation-graph.md` 和 `docs/testing/cases/chat-workspace.md`
