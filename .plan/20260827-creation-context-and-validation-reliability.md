# L 级改动计划：创作上下文与发布校验可靠性重构

## 需求背景

当前多轮公众号创作链路存在一组相互放大的系统性问题：完整新提示词可能被识别为继续或修改，历史指令会以多种形态重复进入模型输入，创意主题被当作发布阶段的字面关键词硬校验，失败后下一轮又回退到旧成功状态。结果是用户更换提示词或调整风格时，可能得到旧主题污染、末端误杀和连续失败。

本次目标不是增加关键词、调低匹配阈值或添加无差别重试，而是建立唯一的创作请求事实源，明确新建、修改、继续和追问的状态机，按修改范围选择执行子图，并将内容语义检查从 Artifact 完整性校验中拆出。

## 分级结论

```text
需求分级：L
分级理由：修改会话上下文主链路、共享契约、AI 编排、发布校验、失败恢复和前端交互语义；虽然预计不修改数据库表结构和服务边界，但属于核心创作架构重构。
影响面：apps/web、apps/service、packages/contracts、Conversation Working Memory、Creation Graph、RunEvent、Artifact 校验、模块/API/测试文档。
是否需要人工确认：是
```

## 目标行为

| 用户输入 | 系统行为 | 继承范围 |
| --- | --- | --- |
| 一套自洽、完整的新创作需求 | `new`，替换当前创作任务 | 默认不继承旧 Brief、正文、呈现和资源 |
| “换种风格重新实现” | `revise(style)`，只运行呈现、排版和审校子图 | 保留内容事实、正文和图片语义，替换呈现决策 |
| “把第二段写得更自然” | `revise(body)`，从正文相关节点重跑 | 保留主题、事实、素材和未涉及部分 |
| “接着写”“补充案例” | `continue`，扩展当前任务 | 继承当前内容身份和明确可用素材 |
| 新旧意图冲突或置信度不足 | `clarify`，在产生模型创作成本前追问 | 不执行正文和 Artifact 节点 |
| 内容语义一致但没有复述创意主题原句 | 审校通过或给出 warning | 不因字面主题覆盖率而失败 |
| 明确离题或遗漏强制事实 | 在审校阶段定向修订 | 不到 Artifact 阶段才首次发现 |

## 非目标

- 不建立跨 Conversation 的用户画像或长期品牌记忆。
- 不引入向量数据库、Embedding 服务或新的生产依赖。
- 不改变浏览器 → Web → Service → 基础设施/模型网关的服务边界。
- 不重做文章编辑器、消息列表或整套 Creation Graph。
- 不将语义质量问题全部降级为可发布；明确离题、事实冲突和安全问题仍可阻止发布。
- 不迁移或重写历史消息、Artifact 和 AgentOutput 原始事实。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 显示本轮解析结果；歧义时追问；失败信息可操作化 |
| 后端服务 | 是 | 统一 IntentResolver、Context Assembler、执行子图和失败恢复 |
| 共享契约 | 是 | 引入规范化创作指令、继承策略、内容身份和结构化失败信息 |
| 数据库 schema | 否（预期） | 新字段保存在现有 JSONB；实施前再次核对约束和索引 |
| 对象存储 | 否 | 继续保存既有快照，不改变对象归属 |
| Redis / 队列 | 否 | Job 仍只传 Run 标识和冻结上下文版本 |
| AI 调用链路 | 是 | 意图歧义解析、Agent 输入裁剪、审校和修订路由变化 |
| 权限 / 安全 | 否 | 不扩大权限；结构化上下文仍需脱敏和 Conversation 隔离 |
| 部署 / 环境变量 | 可能 | 建议使用短期兼容开关灰度切换 V2 上下文 |
| 文档 | 是 | Spec、ADR、模块、API、测试计划和测试用例同步更新 |

## 根因到设计措施的映射

| 根因 | 系统性措施 | 明确不采用 |
| --- | --- | --- |
| Auto 模式依赖关键词和长度 | 结构化意图决策 + 明确状态机 + 低置信度追问 | 继续扩充正则词表 |
| 历史上下文重复拼接 | 单一 `ResolvedCreationRequest`，Prompt 只从结构化字段投影 | 拼接 `effectiveInstruction` 长字符串 |
| 新旧需求没有覆盖规则 | 字段级继承策略和来源追踪 | 依赖 Prompt 中“以本轮为准” |
| `subject` 同时承担创意和校验职责 | 拆分 `creativeTheme` 与 `contentIdentity` | 调整 65% 双字匹配阈值 |
| 语义问题在 Artifact 末端硬失败 | 审校阶段语义门禁 + 定向修订；Artifact 仅做发布完整性硬校验 | Artifact 末端重新调用通用重试 |
| 失败后回到旧成功记忆 | 分离成功基线和最近尝试，保存结构化失败状态 | 用失败输出覆盖成功 Artifact |
| Context 组装有两套实现 | 单一 Context Assembler | 两处同步维护相似函数 |
| 排障只能看到友好提示 | 结构化 Failure Envelope 和决策事件 | 向用户泄露原始 Prompt 或模型输出 |

## 方案设计

### 1. 单一权威创作请求

新增 `ResolvedCreationRequest`，作为一次 Run 唯一、冻结、可审计的创作请求。废弃把历史文本拼接为 `effectiveInstruction` 的做法。

建议契约：

```ts
interface ResolvedCreationRequest {
  schemaVersion: 2;
  operation: "new" | "revise" | "continue" | "clarify";
  decisionSource: "user" | "rule" | "model";
  confidence: "high" | "medium" | "low";
  currentInstruction: string;
  baseArtifactId?: string;
  mutationScope: Array<"content" | "title" | "structure" | "images" | "presentation">;
  inheritance: {
    content: "replace" | "preserve" | "extend";
    presentation: "replace" | "preserve";
    resources: "current_only" | "explicit" | "artifact_used";
  };
  contentIdentity: {
    topicSummary: string;
    namedEntities: string[];
    requiredFacts: string[];
    requiredClaims: string[];
    mustIncludeVerbatim: string[];
    prohibitedClaims: string[];
  };
  provenance: Array<{
    field: string;
    source: "current_turn" | "working_memory" | "artifact" | "resource";
    sourceId: string;
  }>;
  clarification?: {
    reasonCode: string;
    question: string;
  };
}
```

约束：

- `currentInstruction` 在 RunContext 中只能出现一次。
- `new` 模式不得携带旧 `baseArtifactId`、旧 Brief、旧 LayoutPlan 或未显式选择的历史资源。
- `revise` 必须有 `baseArtifactId`，并明确 `mutationScope`。
- 每个继承字段必须能追溯到消息、Artifact 或 Resource。
- Agent 不再自行读取完整历史或重新拼接 memory。

### 2. 意图状态机

IntentResolver 分三层工作：

1. 用户显式选择 `new/revise/continue` 时直接采用。
2. 对无歧义操作进行确定性判断，例如纯“继续”、明确“修改上一版标题”。
3. 其余 `auto` 输入使用结构化模型分类；模型失败时规则只提供保守兜底，不能把不确定的新需求默认归为继续。

Auto 判定必须比较“本轮内容身份”和“当前成功基线”：

- 本轮包含独立主题、事实、对象和目标，并与基线明显不同：`new`。
- 本轮主要引用上一版并指定修改维度：`revise`。
- 本轮要求追加、延展或补充：`continue`。
- 同时出现新主题和“调整风格”等冲突信号，或置信度低：`clarify`。

不再使用“少于 80 字且无资源就默认继续”这类产品语义。

### 3. 唯一 Context Assembler

新增一个由 `conversations` 模块拥有的 Context Assembler，替代 `conversation-lifecycle.ts` 和 `persistence.ts` 中重复的上下文构建逻辑。

输入：

- 当前不可变 UserMessage。
- 当前 Working Memory 成功基线。
- 最近一次尝试摘要。
- 用户明确选择的资源。
- IntentResolver 结果。

输出：

- 冻结的 `CreationRunContextV2`。
- 唯一的 `ResolvedCreationRequest`。
- 已裁剪且带来源的资源集合。

Agent Prompt 由专用投影器产生：Brief 只接收内容身份和本轮内容约束；Presentation 只接收已确认内容、用户呈现约束和品牌信息；Reviewer 接收验证契约。任何 Agent 都不得再次组合完整 Working Memory。

### 4. 修改范围驱动执行子图

Creation Graph 根据 `mutationScope` 选择起点和必须保持不变的字段：

| 修改范围 | 重跑节点 | 必须保持 |
| --- | --- | --- |
| `presentation` | Presentation → Layout → Review → Artifact | 标题、正文、章节 ID、图片语义 |
| `title` | Title → 必要的 Layout → Review → Artifact | 正文事实和章节结构 |
| `content/body` | ContentPlan/Writer → ImagePlan（仅受影响时）→ Presentation → Layout → Review → Artifact | 未涉及约束和资源来源 |
| `continue` | ContentPlan → Writer → 后续完整链路 | 既有事实和禁止项 |
| `new` | Brief 开始的完整链路 | 只保留显式全局品牌/Skill 设置 |

每条子图增加前后不变量断言。例如风格修改后正文内容哈希、章节 ID 和图片语义引用必须保持不变，否则在进入 Artifact 前返回内部契约错误。

### 5. 内容身份与创意主题分离

`CreativeBrief.subject` 调整为展示/创意用途的 `creativeTheme`，不得作为字面发布硬门禁。真正的内容一致性由 `contentIdentity` 承担：

- 专有名词、数字、时间、活动名等结构化事实可做确定性校验。
- 用户明确要求原文出现的内容仅由 `mustIncludeVerbatim` 做字面校验。
- 抽象主题、故事含义和观点用 Reviewer 的结构化语义判断，并要求返回正文证据片段和置信度。
- Reviewer 不得只返回总分，必须按 required fact/claim 逐项给出 `covered/missing/contradicted/uncertain`。

### 6. 校验分层与失败政策

| 层级 | 示例 | 处理方式 |
| --- | --- | --- |
| Hard integrity | Schema 无效、章节/资源引用不存在、Prompt 泄漏、标题来源无效、安全违规 | 阻止 Artifact；返回结构化错误 |
| Repairable quality | 必需事实遗漏、明确离题、事实冲突、修改范围被破坏 | 路由到对应 Agent 定向修订，受最大次数限制 |
| Warning | 抽象主题置信度不足、风格偏差、轻微表达问题 | 生成可预览 Artifact，标记人工确认 |

Artifact Builder 只执行 Hard integrity 校验和封装，不再首次判断文章语义。达到最大修订次数时：

- 结构完整且只是语义不确定：`completed/warning`，保留预览。
- 有明确反向证据证明离题或事实冲突：`failed/recoverable`，保留草稿和逐项证据，允许定向重试。

### 7. 成功基线与最近尝试分离

Working Memory 拆分两个概念：

- `successfulBaseline`：最近成功 Artifact 及其内容身份，只有发布产物成功后更新。
- `lastAttempt`：最近 Run 的指令、解析模式、修改范围、终态和可恢复输出引用；成功或失败都更新。

下一轮解析规则：

- 新提示词只以当前 Turn 为最高优先级。
- 用户说“重试”时复用 `lastAttempt` 的冻结请求，不重新从旧消息推断。
- 用户说“继续修改”时以成功基线为内容事实，并显式合并最近失败尝试中的修改意图。
- 失败尝试不得静默覆盖成功 Artifact，也不得被静默丢弃。

优先将上述字段保存在现有 `conversation_memories.memory_json` 中；实施前确认 JSONB 校验和并发版本控制，无需数据库迁移则不修改 schema。

### 8. 结构化失败与可观测性

新增安全的 `CreationFailureEnvelope`：

```ts
interface CreationFailureEnvelope {
  code: string;
  stage: string;
  category: "integrity" | "quality" | "provider" | "system";
  recoverability: "retry_same" | "revise_input" | "clarify" | "none";
  summary: string;
  violations: Array<{ code: string; target: string; evidence?: string }>;
}
```

RunContext 和持久化事件记录：解析模式、决策来源、置信度、修改范围、继承来源和校验分类。前端只展示安全摘要，例如“已识别为修改上一版的呈现风格”；不展示原始模型 Prompt、内部思维链或敏感资源内容。

## 风险受控落地策略

### 核心原则

目标架构与迁移架构分开设计。目标架构最终只保留 V2 单一请求和单一上下文组装路径；迁移期间允许 V1/V2 双读、影子计算和双轨校验，但影子结果不能修改 Run、Working Memory、Artifact 或用户可见终态。

```text
建立正确性基准
→ 发布 V1/V2 兼容读能力
→ V2 影子计算，不接管执行
→ 显式模式先使用 V2
→ 修改范围逐类接管
→ 新旧校验双轨裁决
→ Auto 小流量灰度
→ 全量 V2
→ 停止 V1 写入，保留历史只读适配
```

任何阶段没有达到退出门禁，都不得进入下一阶段。

### 1. 正确性基准集

从历史问题和脱敏真实输入建立可重复回放的 Golden Dataset。每个样本必须人工标注：

- 期望 `operation`。
- 期望 `mutationScope`。
- 内容、呈现和资源的期望继承策略。
- 是否需要追问。
- 期望重跑节点。
- 内容一致性和最终 Artifact 结果。

最低覆盖以下场景：完整新提示词但没有“新主题”字样、纯风格修改、标题/正文/图片修改、继续扩写、新提示词中包含“风格”、抽象主题同义改写、明确离题、失败后重试、失败后切换主题，以及有无资源的切换。

基准样本不得包含真实用户敏感数据；优先将真实问题改写为等价合成样本，只保留必要语义结构。

### 2. V1/V2 加法兼容

- 先增加 V2 契约和 V1 → V2 只读适配器，不删除 V1 字段。
- Worker 必须先具备 V1/V2 双读能力，再允许任何入口写 V2。
- 历史 RunContext、已排队 Job 和正在运行的 V1 Run 必须继续可执行。
- 兼容层只负责形状转换，不得通过旧拼接文本反推新的高置信度语义；无法可靠恢复的字段标记 `unknown`。

### 3. IntentResolver 影子模式

影子模式对真实请求计算 V2 决策，但生产仍按原路径执行。影子输出只能写入受控诊断记录，且不得包含完整 Prompt、模型原始输出或敏感资源内容。

建议记录：旧判定、新判定、决策来源、置信度、修改范围、继承策略、分歧类型、耗时和模型调用成本。

影子模式退出门禁：

- Golden Dataset 全部关键用例通过。
- “完整新提示词误判为 revise/continue”和“纯修改误判为 new”两类关键错误均为零。
- 人工抽样确认新旧分歧有明确、可解释的正确方向。
- 解析失败时进入保守追问或显式模式，不默认继承旧任务。

### 4. 上下文去重先于 Auto 接管

先在用户显式选择的 `new/revise/continue` 中启用 V2 Context Assembler，Auto 继续影子运行。这样可以独立验证上下文唯一性，而不同时承担意图语义变化。

必须满足以下运行时不变量：

```text
所有模式：
  currentInstruction 在规范化请求中恰好出现一次
  每个 provenance sourceId 不重复

new：
  baseArtifactId 不存在
  旧 Brief / LayoutPlan / DraftSummary 不进入 RunContext
  未显式选择的历史 Resource 数量为 0

revise(style)：
  baseArtifactId 存在
  正文内容哈希不变
  sectionId 集合不变
  图片语义引用不变
```

不变量失败属于内部契约错误，必须停止本次 Artifact 写入，不能静默回退到拼接式上下文。

### 5. 修改范围逐类接管

按照可验证性从高到低开放：

1. `revise(presentation)`。
2. `revise(title)`。
3. `continue`。
4. `revise(content/body)`。
5. `auto → new`。

每一类至少经过内部工作区回放和小流量验证；上一类未满足不变量和成功率门禁时，不开放下一类。

### 6. 新旧校验双轨裁决

迁移期保留旧主题校验作为观测信号，但逐步取消其单独否决权。新内容身份审校必须返回逐项状态、正文证据和置信度。

| 旧字面校验 | 新内容身份审校 | 迁移期处理 |
| --- | --- | --- |
| 通过 | 通过 | 正常生成 Artifact |
| 失败 | 通过且证据充分 | 生成 `warning` 预览，记录旧规则误杀 |
| 通过 | 明确离题或事实冲突 | 进入定向修订 |
| 失败 | 明确离题或事实冲突 | 进入定向修订 |
| 任意 | 不确定 | `warning` 预览或人工确认，不伪装为确定通过 |
| 任意 | Hard integrity 失败 | 阻止 Artifact |

旧字面校验只有在真实回放证明其不再提供独立有效拦截后，才从执行路径移除；移除后仍可短期保留为影子指标。

### 7. 状态写入隔离

- `successfulBaseline` 仍只在 Artifact 成功后更新。
- 成功或失败都可以追加 `lastAttempt`，但不能覆盖成功基线。
- 影子运行绝不写入 Working Memory。
- “重试”复用失败 Run 的冻结 V2 请求；“开始新创作”不读取失败尝试作为内容来源。
- 并发更新继续使用 `contextVersion` 和事务条件，冲突时重新读取，禁止最后写入者无条件覆盖。

### 8. 灰度与自动停止条件

推荐按“内部测试工作区 → 5% Conversation → 25% → 50% → 100%”推进。灰度单位固定为 Conversation，避免同一会话在 V1/V2 间来回切换。

出现以下任一情况立即停止扩大，并允许关闭 V2 执行开关：

- Artifact 产出率低于发布前基线。
- Run 失败率高于旧链路基线。
- `new` Run 出现未授权的旧 Artifact、旧 Brief 或旧资源。
- `revise(style)` 导致正文哈希、章节 ID 或图片语义发生变化。
- V1 已排队任务不能继续执行。
- `clarify` 比例、模型调用次数、Token 或延迟出现未经批准的显著增长。
- 结构化诊断中出现 Prompt、思维链或敏感资源泄漏。

灰度指标的具体数值阈值必须在前置基准阶段根据当前生产基线填写，禁止在没有基线数据时拍脑袋设定。

## 契约与数据变更

### 共享契约

- `IntentResolution` 演进为或包含 `ResolvedCreationRequest`，移除 `effectiveInstruction` 的业务职责。
- `CreationRunContext` 增加 `schemaVersion` 和规范化请求。
- `CreativeBrief.subject` 兼容迁移为 `creativeTheme`；新增 `contentIdentity`。
- Reviewer 输出增加逐项覆盖证据和校验分类。
- Run 失败响应/事件增加 `CreationFailureEnvelope`。
- 新契约必须使用 Zod 校验并补兼容解析测试。

### 数据兼容

- 历史 `graph_runs.context_json` 保持可读，通过 V1 → V2 只读适配器恢复。
- 新 Run 只写 V2，不批量更新历史 Run。
- `conversation_memories.memory_json` 新增可选结构时提供默认值；若实际数据库仅为 JSONB，则不建迁移。
- 已排队 V1 Job 在部署后仍能执行；Worker 按 context schema version 选择适配器。

## 实施任务

### 前置任务：建立脱敏基准集和当前生产基线

**目标：** 在改变执行行为前固定正确性样本、现有成功率、失败率、耗时和资源继承基线。

**验收标准：**

- Golden Dataset 覆盖本计划列出的全部关键状态转换。
- 每个样本都有人工确认的期望模式、继承范围和结果。
- 生产指标只使用聚合或脱敏数据，不保存完整用户 Prompt。

**allowed_files：**

```yaml
allowed_files:
  - docs/testing/cases/conversations.md
  - docs/testing/cases/creation-graph.md
  - apps/service/src/creation-graph/intent-resolution.test.ts
  - apps/service/src/creation-graph/artifact-builder.test.ts
verification:
  - pnpm --filter @mediaforge/service test -- intent-resolution artifact-builder
```

**依赖：** 无。

### Task 1：冻结 V2 语义契约与架构决策

**目标：** 先定义新建、修改、继续、追问、继承范围、内容身份和校验分层的长期契约。

**验收标准：**

- V2 契约能够表达本计划全部目标行为。
- V1 RunContext 和 Working Memory 有明确兼容策略。
- ADR 明确禁止拼接式 `effectiveInstruction` 和 Artifact 语义硬门禁。

**allowed_files：**

```yaml
allowed_files:
  - docs/specs/024-creation-context-and-validation-reliability.md
  - docs/adr/017-canonical-creation-request-and-validation-layers.md
  - packages/contracts/src/conversations.ts
  - packages/contracts/src/creation-graph.ts
  - packages/contracts/src/creation-graph.test.ts
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/contracts test
```

**依赖：** 前置任务。

### Task 2：实现统一 IntentResolver 与 Context Assembler

**目标：** 产生唯一规范化请求和统一上下文组装能力；第一阶段以影子模式运行，不接管 Auto 生产执行。

**验收标准：**

- 完整新提示词不依赖特定口令即可替换旧任务。
- 当前指令和每个来源消息在模型上下文中最多出现一次。
- `new`、`revise`、`continue` 的继承不变量均有测试。
- 影子结果不更新 Run、Working Memory、Artifact 或用户可见终态。

**allowed_files：**

```yaml
allowed_files:
  - apps/service/src/creation-graph/intent-resolution.ts
  - apps/service/src/creation-graph/intent-resolution.test.ts
  - apps/service/src/creation-graph/context-rebuild.ts
  - apps/service/src/creation-graph/context-rebuild.test.ts
  - apps/service/src/conversations/creation-context-assembler.ts
verification:
  - pnpm --filter @mediaforge/service test -- intent-resolution context-rebuild
  - pnpm --filter @mediaforge/service typecheck
```

**依赖：** Task 1。

### Task 3：接入唯一组装入口并移除重复实现

**目标：** Conversation 生命周期、持久化创建 Run 和 Worker 接入同一 V2 Context；先接管显式模式，Auto 保持影子计算。

**验收标准：**

- 两条 Run 创建路径得到等价的冻结上下文。
- Worker 不再把 `effectiveInstruction` 作为 `userInput`。
- V1 已排队任务能通过适配器继续运行。
- 显式 `new/revise/continue` 通过 V2 执行，Auto 仍按旧路径执行并记录安全分歧。

**allowed_files：**

```yaml
allowed_files:
  - apps/service/src/conversations/conversation-lifecycle.ts
  - apps/service/src/conversations/conversation-lifecycle.test.ts
  - apps/service/src/creation-graph/persistence.ts
  - apps/service/src/creation-graph/persistence.test.ts
  - apps/service/src/creation-graph/worker.ts
verification:
  - pnpm --filter @mediaforge/service test -- conversation-lifecycle persistence worker
  - pnpm --filter @mediaforge/service typecheck
```

**依赖：** Task 2。

### Checkpoint A：上下文基础

- 新提示词、风格修改、继续扩写、歧义输入均有冻结上下文快照测试。
- 新 Run 中不存在重复指令和未授权资源继承。
- Golden Dataset 关键意图错误为零。
- 人工检查脱敏真实多轮对话的影子分歧后再进入 Graph 改造。
- Auto 尚未接管生产执行。

### Task 4：按修改范围裁剪 Agent 输入并选择执行子图

**目标：** 每个 Agent 只接收需要的结构化字段，风格修改不重写正文。

**验收标准：**

- `revise(style)` 只运行 Presentation、Layout、Review 和 Artifact。
- 风格修改前后正文、章节 ID 和图片语义引用保持一致。
- `new` 从 Brief 开始且不含旧内容状态。

**allowed_files：**

```yaml
allowed_files:
  - apps/service/src/creation-graph/agents.ts
  - apps/service/src/creation-graph/agents.test.ts
  - apps/service/src/creation-graph/graph.ts
  - apps/service/src/creation-graph/graph.test.ts
  - apps/service/src/creation-graph/structure-guard.ts
verification:
  - pnpm --filter @mediaforge/service test -- agents graph structure-guard
  - pnpm --filter @mediaforge/service typecheck
```

**依赖：** Task 3。

### Task 5：重构内容一致性与 Artifact 校验

**目标：** 用内容身份和证据式审校替代创意主题双字覆盖率，并在迁移期执行新旧双轨裁决。

**验收标准：**

- 抽象主题的合理改写不会触发 `SUBJECT_MISMATCH`。
- 专有名词、数字、必含原文和禁止项仍有确定性保护。
- 明确离题在 Reviewer 阶段进入定向修订，不在 Artifact 末端首次发现。
- 旧字面校验先降为影子信号或双轨输入，不直接被一次性删除。

**allowed_files：**

```yaml
allowed_files:
  - apps/service/src/creation-graph/artifact-builder.ts
  - apps/service/src/creation-graph/artifact-builder.test.ts
  - apps/service/src/creation-graph/agents.ts
  - apps/service/src/creation-graph/agents.test.ts
  - apps/service/src/creation-graph/graph.ts
verification:
  - pnpm --filter @mediaforge/service test -- artifact-builder agents graph
  - pnpm --filter @mediaforge/service typecheck
```

**依赖：** Task 4。

### Task 6：实现失败状态、恢复语义和安全诊断

**目标：** 保持成功基线，同时记录最近失败尝试并提供可操作恢复路径。

**验收标准：**

- 失败 Run 不覆盖成功 Artifact，但下一轮能识别最近失败的修改意图。
- “重试”复用失败 Run 的冻结请求，不重新拼接历史。
- Run 失败事件包含安全、结构化、可恢复的错误信息。

**allowed_files：**

```yaml
allowed_files:
  - apps/service/src/creation-graph/persistence.ts
  - apps/service/src/creation-graph/persistence.test.ts
  - apps/service/src/creation-graph/worker.ts
  - apps/service/src/creation-graph/worker.test.ts
  - apps/service/src/conversations/conversation-lifecycle.ts
verification:
  - pnpm --filter @mediaforge/service test -- persistence worker conversation-lifecycle
  - pnpm --filter @mediaforge/service typecheck
```

**依赖：** Task 5。

### Checkpoint B：后端完整链路

- 完成 `POST turn → resolve → context → graph → review → artifact/failure` 集成测试。
- 对 V1/V2 上下文各跑一次队列 Worker 回归。
- 检查模型调用次数、Token 输入量和平均耗时没有非预期增长。
- `revise(presentation)` 和 `revise(title)` 满足修改范围不变量后，才允许继续开放其他类型。
- 新旧校验分歧都有证据和裁决结果，不存在静默放行。

### Task 7：前端确认、追问和失败反馈

**目标：** 让用户看得见系统把本轮理解成什么，并能处理歧义和恢复失败。

**验收标准：**

- 任务卡显示“新创作/修改正文/调整呈现/继续扩写”。
- `clarify` 不启动后续创作节点，用户答复后创建新 Run。
- 失败提示区分可重试、需改提示词、需确认意图和不可恢复。

**allowed_files：**

```yaml
allowed_files:
  - apps/web/app/page.tsx
  - apps/web/app/page.test.tsx
  - packages/contracts/src/conversations.ts
  - docs/api/conversations.md
  - docs/api/creation-graph.md
verification:
  - pnpm --filter @mediaforge/web typecheck
  - pnpm --filter @mediaforge/web test
  - pnpm --filter @mediaforge/contracts typecheck
```

**依赖：** Task 6。

### Task 8：模块事实与测试策略同步

**目标：** 同步会话与 Creation Graph 的模块事实、测试范围和长期职责边界。

**验收标准：**

- 模块文档准确描述单一权威请求、执行子图和校验分层。
- 测试计划覆盖意图、继承、内容身份、失败恢复和 V1/V2 兼容。
- 文档不再描述拼接式上下文或 Artifact 主题字面硬门禁。

**allowed_files：**

```yaml
allowed_files:
  - docs/modules/conversations/README.md
  - docs/modules/creation-graph/README.md
  - docs/testing/plans/conversations.md
  - docs/testing/plans/creation-graph.md
verification:
  - pnpm typecheck
```

**依赖：** Task 7。

### Task 9：系统回归矩阵与端到端验收

**目标：** 固化多轮提示词切换、资源隔离、抽象主题和失败恢复用例，并完成全量验证。

**验收标准：**

- 至少覆盖 20 组状态转换组合。
- 覆盖无附件新提示词、包含“风格”但主题全新、抽象同义改写、明确离题、失败后重试和失败后新建。
- 全量类型检查、测试和构建通过。

**allowed_files：**

```yaml
allowed_files:
  - docs/testing/cases/conversations.md
  - docs/testing/cases/creation-graph.md
  - apps/service/src/conversations/conversation-store.test.ts
  - apps/service/src/creation-graph/graph.test.ts
  - apps/web/app/page.test.tsx
verification:
  - pnpm typecheck
  - pnpm test
  - pnpm build
```

**依赖：** Task 8。

### Checkpoint C：发布前

- 全量 typecheck、test、build 通过。
- 使用生产问题对应输入回放：`换种风格重新实现` 必须成功产生新呈现 Artifact，正文内容身份不变。
- 使用完全不同的新提示词回放：必须进入 `new`，RunContext 不含旧主题、旧 Artifact 和旧资源。
- 低置信度输入必须追问，不得静默猜测。
- 结构化日志和事件不包含密钥、完整内部 Prompt 或原始思维链。
- 完成内部工作区验证，并准备按 Conversation 固定分桶的 5% 灰度。
- V2 执行开关和 V1 兼容回退路径经过演练。

## 验证方案

### 契约测试

- V1/V2 RunContext 解析。
- `ResolvedCreationRequest` 状态不变量。
- Failure Envelope 脱敏和长度限制。

### 单元测试

- Intent 状态转换表。
- 字段级继承与来源追踪。
- Prompt 投影无重复、无越权历史。
- 内容身份确定性校验。
- Artifact Hard integrity 校验。

### 集成测试

- 新建 → 风格修改 → 正文修改 → 继续扩写。
- 成功 → 失败 → 重试。
- 成功 → 失败 → 完整新提示词。
- 新主题资源隔离和修改 Artifact 资源继承。
- Reviewer 修订回路和最大次数分流。

### 手动验证

1. 原生产案例：个人术后感悟文章，随后输入“换种风格重新实现”。
2. 在同一会话直接输入一套餐饮品牌活动新需求，不带“新主题”字样。
3. 输入“更温暖一点，但改成儿童摄影主题”验证冲突追问或新建判断。
4. 输入抽象主题并要求正文自然表达，不复述主题原句。
5. 模拟 Provider 超时、Schema 错误和明确离题，检查三类错误反馈。

### 全量命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
pnpm typecheck
pnpm test
pnpm build
```

## 迁移与回滚

### 迁移

1. 建立脱敏 Golden Dataset 和当前生产指标基线。
2. 发布兼容读取 V1/V2 的契约和 Worker，不改变执行行为。
3. 启用 V2 IntentResolver 影子计算，生产仍执行 V1。
4. 人工审查影子分歧并达到 Checkpoint A 门禁。
5. 显式 `new/revise/continue` 接入 V2 Context Assembler，Auto 继续影子运行。
6. 按 `presentation → title → continue → content/body → auto new` 顺序逐类接管。
7. 新旧内容校验双轨运行，按证据裁决误杀和真实离题。
8. 在内部工作区回放历史 RunContext 和生产问题样本。
9. 按 Conversation 固定分桶执行 5% → 25% → 50% → 100% 灰度。
10. 稳定后停止 V1 写入，保留历史只读适配器和短期影子指标。

### 回滚

- 保留短期功能开关，可停止写入 V2 并恢复 V1 执行路径。
- V2 不破坏原始 Message、Artifact 和 Resource，回滚不需要数据反向迁移。
- 已创建的 V2 Run 由兼容 Worker 执行完或安全取消，不混用两种上下文。
- 若新增 JSON 字段引起问题，旧代码忽略可选字段；不得删除历史事实。
- 灰度按 Conversation 固定分桶；回退时整个 Conversation 回到同一路径，避免同一会话上下文版本交叉。
- 影子记录不是业务事实，关闭影子模式不影响 Run 和 Artifact 恢复。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 模型式 IntentResolver 增加延迟和成本 | 中 | 明确输入走确定性路径，仅歧义输入调用；记录调用率和耗时 |
| 追问过多打断创作 | 中 | 只在会改变主题或继承范围时追问，设置离线真实样本阈值 |
| 校验放松导致离题内容发布 | 高 | 不是删除校验，而是使用逐项内容身份、证据和定向修订 |
| 风格子图复用旧正文时结构不兼容 | 中 | 进入子图前做 Artifact/ArticleDocument 兼容校验，不兼容时明确扩大重跑范围 |
| V1 排队任务部署后失败 | 高 | 先发布双读适配器，再切换 V2 写入 |
| Working Memory 并发覆盖 | 高 | 继续使用 contextVersion/事务条件更新，补并发 Run 测试 |
| 前端默认 Auto 行为变化 | 中 | 显示解析标签，保留用户显式模式选择作为最高优先级 |
| 影子模式意外写入业务状态 | 高 | 将影子输出限制为受控诊断接口，测试断言 Run、Memory、Artifact 零写入 |
| 同一会话落入不同灰度版本 | 高 | 以 Conversation 固定分桶，不按单次请求随机分流 |
| 没有生产基线导致错误阈值 | 中 | 前置任务先采集基线，阈值作为灰度启动条件人工确认 |

## AI 自审

```text
AI 自审结论：通过，需人工确认后实施
分级复核：L 级合理；虽然没有服务边界和预期 schema 迁移，但修改核心 AI 主链路、共享契约和失败语义。
服务边界：保持浏览器 → Web → Service → PostgreSQL/MinIO/Redis/Model Gateway，不新增跨层访问。
契约与数据：先改共享契约；历史 RunContext 双读、新 Run V2 写入；预计只改 JSON 形状，实施前再次核对数据库约束。
异常路径：覆盖意图歧义、模型分类失败、语义修订耗尽、Hard integrity 失败、Provider 失败和失败后重试。
安全风险：不向前端暴露 raw prompt、思维链或敏感资源；Provenance 只保存受控标识。
测试方案：包含 Golden Dataset、契约、单元、影子零写入、集成、手动回放、兼容、灰度回退和全量构建验证。
反方意见：可以只删除 SUBJECT_MISMATCH 或把阈值降为 30%，但这不能解决提示词切换、上下文重复和失败循环，且会失去离题保护，因此不采用。
需要人工重点看的问题：Auto 模式低置信度时是否接受一次追问；影子分歧达到什么生产基线才允许接管；明确离题达到修订上限时选择 failed/recoverable 而不是 warning Artifact。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-27
备注：用户明确要求“开始实施”；按风险受控增量、检查点和灰度门禁执行。
```

## 实施结果（2026-08-27）

```text
本地实施状态：完成
自动化验证：pnpm typecheck、pnpm test、pnpm build 全部通过
契约测试：40 passed
认证测试：14 passed
服务测试：125 passed
前端测试：21 passed
Worker：当前无独立测试文件，类型检查与构建通过
```

已完成 Task 1 至 Task 9 的代码、契约、文档和自动化回归部分：

- `ResolvedCreationRequest`、`CreationSnapshot`、`CreationFailureEnvelope` 和 Working Memory 双状态已落地。
- 首次 Turn、后续 Turn 和兼容持久化入口共用 Creation Context Assembler。
- V1/V2、shadow、显式接管、固定 Conversation 分桶和旧 Artifact 兼容已落地。
- 完整新需求、明确重试、仅呈现修订和歧义追问已形成互斥执行语义。
- 仅呈现修订使用快照恢复和 mutation scope 不变量，不改写正文、标题、结构或图片语义。
- 创意主题字面不命中降为诊断；逐字硬要求、结构、标题来源和范围越界仍为硬校验。
- 失败尝试与成功基线隔离，前端展示解析后的操作类型和可恢复建议。
- 模块、API、测试计划和回归用例已同步。

发布阶段仍需完成：生产问题输入回放、真实 Model Gateway 调用次数/Token/耗时基线、影子分歧人工裁决，以及按 Conversation 固定分桶的 5% → 25% → 50% → 100% 灰度。上述项目未在本地实施中伪报为完成，也不阻塞代码进入部署准备状态。
