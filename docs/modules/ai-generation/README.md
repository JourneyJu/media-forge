# 模块：AI 生成

## 模块定位

AI 生成模块负责编排工作区配置、当前创作会话上下文、素材识别结果、排版 skill、历史记忆摘要和用户指令，生成或修改结构化文章。

公众号 Agent 使用可持久化状态机执行多步骤编排。Conversation-first 架构下，创作会话与任务模块负责 `Conversation`、`Run`、`RunStep`、`RunDecision` 和 `Artifact` 的生命周期；AI 生成模块负责 Brief、计划、写作、审阅、渲染前编排和模型调用。模型只输出结构化决策和内容，步骤推进、循环次数、暂停和版本保存由后端 Orchestrator 决定。

## 职责边界

### 负责

- 生成任务创建。
- prompt 上下文组装。
- 模型网关调用。
- JSON schema 校验。
- 生成结果交给文章版本模块保存。
- 用量日志写入。
- 对话式修订文章结构。
- 生成并执行结构化 AgentPlan。
- 管理排版、扩充、审阅、重构和终审步骤。
- 根据确认策略进入 `waiting_user` 并接收用户决定。
- 控制循环上限、评分停滞和最佳版本保留。
- 向前端发布可恢复的步骤事件。
- 模型失败、解析失败、配额失败、策略失败和系统失败分类。
- 根据当前 Conversation 构建 CreativeBrief。
- 判断是否需要追问，并输出结构化 clarification。

### 不负责

- 模型供应商密钥管理 UI。
- 图片原文件处理。
- 前端编辑器渲染。
- 微信 HTML renderer 的样式规则实现。
- Conversation、Run、Artifact 的事实数据生命周期。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| GenerationJob | 一次生成或修订任务。 |
| PromptContext | 工作区、素材、skill、记忆和用户指令组装后的上下文。 |
| ModelGatewayRequest | 发给模型网关的标准请求。 |
| ArticlePatch | 对当前文章结构的增删改操作。 |
| UsageLog | 模型、token、耗时、状态和成本记录。 |
| AgentRun | 一次端到端公众号 Agent 执行。 |
| AgentStep | AgentRun 内一个可追踪、可重试的步骤。 |
| AgentPlan | 策划 Agent 生成的执行计划和验收目标。 |
| CreativeBrief | 从当前 Conversation、资源和工作区记忆摘要整理出的创作简报。 |
| ClarificationQuestion | 信息不足时返回给用户的结构化追问。 |
| ArticleOutline | 排版 Agent 生成的文章骨架、素材位置和目标字数。 |
| ReviewReport | 审阅问题、评分、决策和下一步动作。 |
| UserDecision | 用户对等待节点的选择、补充说明和操作者信息。 |

## 模型配置

运行时从 PostgreSQL 的 `model_routes`、`model_configs` 和 `model_connections` 解析模型。业务模型环境变量已退出；缺少 active 路由时返回 `GENERATION_MODEL_UNAVAILABLE`。API Key 使用 AES-256-GCM 加密保存，前端不得接收、展示或保存密钥。

## 状态和流程

### 生成初版

```text
创建 GenerationJob
→ 读取 workspace、assets、layout_skill_pack、workspace_memory
→ 生成 prompt snapshot
→ 调用 Model Gateway
→ 校验 ArticleDocument
→ 调用文章模块保存版本
→ 写 model_usage_logs
```

### 对话修订

```text
接收用户指令
→ 读取当前 ArticleVersion.content_json
→ 生成 ArticlePatch 或完整 ArticleDocument
→ 校验并应用
→ 调用文章模块保存新版本
```

### Conversation-first Run 状态机

目标状态机由创作会话与任务模块保存，AI 生成模块负责推进策略：

```text
queued
→ building_brief
→ waiting_clarification（可选）
→ planning
→ writing
→ planning_images
→ reviewing
→ rendering
→ completed
```

任意运行态可进入 `failed` 或 `cancelled`。只有 `waiting_clarification` 可以由用户补充必要信息后恢复；用户不确认内部执行计划。

### 旧 Agent 状态机

```text
queued
→ analyzing_assets
→ planning
→ waiting_user（可选）
→ layout
→ expanding
→ reviewing
→ revising / restructuring
→ expanding
→ final_review
→ rendering
→ completed
```

旧 `AgentRun` 状态机仅作为过渡期兼容。新实现应迁移到 `Run` / `RunStep` / `RunDecision`。

### 步骤规则

- `layout` 只允许输出 `ArticleOutline`，不生成完整长正文。
- `expanding` 只能在既定 outline 内补充内容；章节增删移动必须进入 `restructuring`。
- `reviewing` 必须输出结构化 `ReviewReport`，不得直接静默改文。
- `restructuring` 保存新骨架版本，再重新进入 `expanding`。
- 局部修订最多 2 次，结构重构最多 2 次，总步骤最多 12 步。
- 连续两次评分无提升、重构范围超过 30% 或素材冲突时进入 `waiting_user`。
- 每一步使用幂等键，任务重试不得重复创建文章版本。

## 数据归属

| 数据 | 归属 | 说明 |
| --- | --- | --- |
| generation job | PostgreSQL / Redis | 最终状态需可追溯 |
| prompt snapshot | MinIO / S3 | 生成上下文快照 |
| generation_usage_events | PostgreSQL | 每个 accepted Run 的用户生成次数 |
| model_usage_logs | PostgreSQL | 每次真实供应商调用、状态、延迟和 token |
| model connection / config / route | PostgreSQL | 加密连接、模型能力和默认路由 |
| run / step / decision / artifact | PostgreSQL | 状态、计划、步骤结果、用户决定和任务产物是不可丢失事实 |
| agent progress / lock | Redis | 短期进度、队列、分布式锁，不作为事实源 |
| step prompt / raw output | MinIO / S3 | 脱敏后的不可变快照 |

## API 路由

- `docs/api/ai-generation.md`

## 测试路由

- `docs/testing/plans/ai-generation.md`
- `docs/testing/cases/ai-generation.md`

## 风险

- 模型输出视为不可信输入，必须校验后再落库。
- prompt 快照不得包含密钥或敏感配置。
- 外部 AI 调用不得长时间占用数据库事务。
- 不向普通用户展示模型原始思维链；右侧仅展示计划、依据摘要、结果、问题和下一步。
- Agent 自动循环必须有硬上限，避免成本失控和无限重写。
- 用户决定必须校验 run 当前处于 `waiting_user`，并使用版本号防止重复提交。
