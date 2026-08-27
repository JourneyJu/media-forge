# ADR-017：采用单一创作请求与分层校验

## 状态

Accepted

## 日期

2026-08-27

## 背景

多轮创作同时存在原始消息、Working Memory、IntentResolver 输出和 Agent 自行拼接的上下文。当前 `effectiveInstruction` 会把历史文本和本轮指令合成字符串，后续 Agent 又可能追加 Working Memory，导致本轮指令重复、旧主题权重放大和资源继承边界不清。

最终 Artifact 还使用 `CreativeBrief.subject` 的连续双字覆盖率判断主题一致性。`subject` 是创意表达，不是必须逐字出现的事实锚点，因此抽象主题的合理改写可能在发布末端被误判。该判断与 Reviewer 的语义审校也可能得出相反结果。

## 决策

### 单一创作请求

每个 V2 Run 冻结一个 `ResolvedCreationRequest`，它是本次执行的唯一创作请求事实源，包含：

- `operation`：`new`、`revise`、`continue` 或 `clarify`。
- `currentInstruction`：只保存一次的本轮原始指令。
- `mutationScope`：允许修改的内容、标题、结构、图片或呈现范围。
- `inheritance`：内容、呈现和资源的字段级继承策略。
- `contentIdentity`：主题摘要、实体、必要事实、必要观点、逐字要求和禁止观点。
- `provenance`：每个继承字段的消息、Artifact 或 Resource 来源。

Agent 只消费从该请求和冻结 RunContext 投影出的职责内字段，不读取完整历史，不重新拼接 Working Memory，也不把拼接字符串作为新的 `userInput`。

### 意图决策

用户显式选择的模式优先。无歧义操作可以走确定性规则，其余 Auto 输入使用结构化决策；低置信度且会改变主题或继承范围时进入 `clarify`，不能默认继承旧任务。

V2 先影子计算，再从显式模式开始接管。影子结果不得写 Run、Working Memory、Artifact 或用户可见终态。

### 内容身份和创意主题分离

`CreativeBrief.subject` 在兼容期保留，并逐步作为 `creativeTheme` 的展示别名。它不再承担抽象主题的字面发布硬门禁。

内容一致性依据 `contentIdentity`：

- 实体、数字、时间和明确事实可确定性校验。
- 只有 `mustIncludeVerbatim` 才要求逐字出现。
- 抽象主题、故事含义和观点由 Reviewer 按项目逐项返回覆盖状态、正文证据和置信度。

### 校验分层

- Hard integrity：Schema、结构引用、资源引用、Prompt 泄漏、安全和标题来源，失败时阻止 Artifact。
- Repairable quality：明确离题、必要事实遗漏、事实冲突和修改范围越界，进入定向修订。
- Warning：抽象语义不确定或轻微风格偏差，可以生成需人工确认的预览。

Artifact Builder 只执行发布完整性硬校验，不在末端首次判断抽象主题语义。

### 状态隔离

Working Memory 区分最近成功基线和最近尝试。成功基线只在 Artifact 成功后更新；成功或失败都可以记录最近尝试，但失败不得覆盖成功 Artifact。重试复用失败 Run 的冻结请求，而不是重新拼接历史消息。

## 兼容与迁移

- 先发布 V1/V2 双读能力，再允许 V2 写入。
- 历史 V1 RunContext 通过只读适配器继续执行，不批量迁移。
- V2 IntentResolver 先影子运行；显式模式先接管，Auto 最后灰度。
- 迁移期旧字面校验作为影子信号参与双轨裁决，不直接一次性删除。
- 灰度按 Conversation 固定分桶，避免同一会话混用两种上下文。
- 不新增数据库表或生产依赖；新增结构优先保存在现有 JSONB 中。

## 影响

- Contracts 增加版本化规范请求、内容身份、来源和结构化失败契约。
- Conversations 模块拥有唯一 Context Assembler。
- Creation Graph 根据 `mutationScope` 选择执行子图并检查不变量。
- Reviewer 输出逐项证据，Artifact Builder 收敛为完整性边界。
- Web 显示安全的意图摘要、澄清和可恢复失败信息。
- 增加影子决策和结构化诊断成本，但不记录完整 Prompt 或模型思维链。

## 不采用的方案

### 扩充正则和长度阈值

不采用。它不能稳定识别完整新提示词，也会不断增加不可解释的冲突规则。

### 继续拼接历史文本并强调“本轮优先”

不采用。Prompt 约束不能替代结构化优先级和来源边界。

### 只删除 `SUBJECT_MISMATCH`

不采用。它能消除误杀，但同时失去对真实离题和必要事实遗漏的保护。

### 一次性切换所有请求

不采用。V1 排队任务、历史上下文、意图误判和状态并发无法安全回退。

## 一致性要求

- V2 `currentInstruction` 只能出现一次。
- `new` 不得携带旧 Artifact、旧 Brief、旧布局或未显式资源。
- `revise` 必须有基准 Artifact 和明确修改范围。
- `revise(presentation)` 不得改变正文、章节 ID 和图片语义。
- 影子模式必须零业务写入。
- 所有错误和诊断均不得暴露 raw prompt、完整正文、思维链、密钥或敏感资源。

