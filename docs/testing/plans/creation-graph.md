# 测试方案：Creation Graph 多 Agent 编排

## 测试目标

验证 LangGraph + BullMQ 多 Agent 架构在公众号创作主链路中的正确性、可恢复性、流式反馈和最终内容边界。

本方案是目标验收门禁。当前只有 Graph、Queue/Worker 和前端事件的部分单元测试，不代表端到端主链路已通过。

## 范围

- Run 创建与队列入队。
- Redis、Worker 和 Model Gateway 健康检查。
- Worker 从 PostgreSQL 读取真实 Conversation 上下文。
- Worker 从冻结 RunContext 读取会话 Working Memory 摘要。
- Worker 消费任务并执行 LangGraph。
- Agent 节点顺序和状态转换。
- 追问、恢复和幂等。
- RunEvent SSE 断线续传。
- Artifact 和 ArticleVersion 创建。
- 最终内容防污染。
- 标题候选生成、自动选择和标题来源校验。
- Review / Revision 后的标题来源一致性校验。
- 入队 Outbox、重复消费和 Artifact 幂等。
- 生产环境 Demo 禁止和模型路由门禁。
- 最新 Turn、CreationMode 和本轮/继承资源隔离。
- MaterialSummary、ContentPlan、结构化 ArticleDraft 和 LayoutPlan。
- Reviewer 按问题类型回退节点，以及未通过时禁止创建 Artifact。
- Skill 规则和品牌资源在 Brief、Planner、Writer、Layout、Reviewer 的阶段化应用。
- 模型流式 reasoning/content 解析、安全摘要、阶段事件和非流式回退。
- heartbeat、超时、失联 Run 恢复和唯一终态。

## 不覆盖

- 模型供应商真实质量评测。
- 微信公众号真实发布。
- 大规模压测。

## 测试层级

| 层级 | 覆盖内容 |
| --- | --- |
| Contract 测试 | Graph State、CreationMode、结构化 ArticleDraft、LayoutPlan、AgentOutput、RunEvent schema。 |
| Unit 测试 | 单个 node、意图策略、资源范围、Title policy、Artifact Builder、Renderer、clarification policy。 |
| Integration 测试 | `POST /runs` → queue → worker → events → artifact。 |
| API 测试 | 追问提交、任务列表、事件流。 |
| UI 测试 | 对话流、任务卡、手机预览更新。 |

## 结构身份与版本验证

结构一致性测试应覆盖 Model Raw Output → Canonicalizer → Structure Guard → ArticleDocument 的完整边界。模型 Raw Schema 不得要求 Outline、Draft、Revision 或 Presentation 回传 `sectionId`、`structureVersion`；Canonical 对象必须由当前 ContentPlan 注入权威身份，并在 Outline、Draft、ImagePlan、LayoutPlan 与 ArticleDocument 之间保持一致。

Outline、Draft 和 Revision 只有在章节数量与 ContentPlan 完全一致时才允许按顺序绑定。ImagePlan 和 LayoutPlan 的 `sectionIndex` 只作为单次调用内的局部选择，必须先验证整数范围再转换为 `sectionId`。标题文本变化不应改变章节身份；增删章节、无效索引、重复引用、未知 Canonical 引用和过期版本必须在责任节点后被发现。

模型输出纠错测试需要区分三类行为：Raw Schema、章节数量或局部索引错误最多纠错当前节点一次；纠错不消耗内容 Revision 次数，也不触发队列级或整 Graph 重试；Canonical Structure Guard 失败不交给模型修复。Review 引发的内容修订按现有修订上限计数。历史兼容测试必须验证旧 payload 只读映射和无法可靠映射时的重跑行为。

## 流式过程反馈

- Gateway 正确解析跨 chunk 的 `reasoning_content` 和 `content`。
- `content` 分片不进入前端，流结束后才执行 JSON/Zod 校验。
- reasoning 摘要经过限长和敏感内容过滤。
- 不支持 reasoning 或 stream 的模型回退到真实阶段事件，不生成伪思考。
- Worker 不持久化供应商原始 reasoning，每个 Agent 只发布平台映射的安全业务摘要。
- 5 秒无有效进度时发送 heartbeat，终态后停止。
- 首个增量慢、单 Agent 超时、Run 超时和 Worker 中断都产生明确失败或恢复结果。
- 同一个 Run 只能产生一个业务终态。
- Review 未通过但达到修订上限时，验证最后草稿的 Artifact、warning 完成事件、未解决问题提示以及 Artifact Builder 失败仍为真正失败。

## 关键场景

### 正常创作

```text
用户发送需求
→ 创建 Run
→ Worker 执行 Brief / Title / Outline / Writer / ImagePlan / Review / Render
→ 写 artifact.created
→ 前端手机预览更新
```

验证：

- 不出现计划确认。
- 任务卡进度完整。
- Artifact 存在。
- 手机预览内容不含过程信息。
- 标题来自候选集合，不等于用户原始输入。
- Review 或 Revision 之后标题仍来自 Title Agent `selectedId`；非标题问题不得改写标题。
- Worker 读取的是当前 Conversation 上下文。
- 修改类请求基于 `lastArtifactId` 和 Working Memory 处理，不从空白上下文重新生成。

### 信息不足追问

```text
用户输入过短
→ Clarification Agent 返回问题
→ Run 进入 waiting_clarification
→ 前端展示追问卡
→ 用户回答
→ Graph resume
→ 完成 Artifact
```

验证：

- 只在必要时追问。
- 追问答案幂等。
- resume 后不会重复执行已完成节点。

### Worker 失败

```text
Writer Agent 抛错
→ AgentTask failed
→ RunEvent run.failed
→ Run status failed
```

验证：

- 错误摘要可展示。
- 不创建坏 Artifact。
- 支持后续重试。

### Redis 不可用

```text
创建 Run
→ PostgreSQL 写 Run 和 Outbox
→ Redis 入队失败
→ Outbox 保留待投递
→ Redis 恢复后重派
```

验证：

- 不静默执行 legacy。
- 不丢失 Run。
- 不重复创建 Job。

### SSE 断线续传

```text
客户端收到 event_no=4 后断线
→ 重新连接 /events?after=4
→ 补发未读事件
```

验证：

- event_no 单 Run 内递增。
- 不重复展示已确认事件。
- completed 后连接关闭或停止重连。

## 回归范围

- `packages/contracts` typecheck。
- `apps/service` typecheck。
- `apps/service` test。
- `apps/worker` typecheck/test。
- `apps/web` typecheck。
- Playwright 验证聊天流、任务卡和手机预览。

## 风险点

- LangGraph checkpoint 与业务状态不一致。
- Worker 重试导致重复 Artifact。
- Agent 输出自然语言过程混入正文。
- SSE 重连重复事件。
- 队列不可用时 Run 卡在 queued。
- 自动 Demo 回退掩盖模型配置错误。
- 原始用户提示词被当作 `subject`、标题或正文。
- Revision Agent 在正文、图片、结构或版式修订中改写标题，导致 `TITLE_SOURCE_INVALID`。
- Working Memory 被当作最终正文事实源，覆盖 Artifact / ArticleDocument。
- 历史用户消息拼接后覆盖最新 Turn 的主题。
- 新创作自动携带会话内旧素材或旧 LayoutPlan。
- UI 展示多 Agent 步骤，但底层实际执行 Demo 或固定模板。
- 推理摘要泄露系统 prompt、Skill 指令、密钥或未脱敏隐私。
- 增量事件写放大导致 PostgreSQL 压力。
- 模型流结束但 Run 没有终态，页面静默停止。
- Layout Agent 输出任意 HTML/CSS 绕过可信 Renderer。
- 章节标题被误当作身份，正常润色触发 `CONTENT_PLAN_DRIFT`。
- 新 ContentPlan 与旧 Draft、ImagePlan 或 LayoutPlan 因缺少结构版本而混用。
- Revision 擅自增删或换序章节，直到 Artifact 阶段才被发现。
- 历史适配器通过标题相似度猜测章节，掩盖真实结构冲突。
- 模型 Raw 输出继续携带系统 ID，字符转置或截断导致正常内容失败。
- Canonicalizer 在章节数量不一致时按位置强行绑定，掩盖真实增删章。
- `sectionIndex` 越界、跨版本复用或被错误持久化为主身份。
- 节点级结构纠错错误计入内容 Revision，或意外触发整条 Graph 重跑。

## 旁路摘要专项验证

- 契约：摘要长度、受控 category、`active_step_only`、执行身份和修订号。
- 输入安全：Prompt、凭据、隐私、URL、路径、UUID、代码和 JSON 命中后整窗拒绝。
- 输出安全：严格 schema、subject 输入落地校验、服务端模板和 120 字上限。
- 生命周期：完成、失败、重试和取消时清空内存并取消调用；迟到结果不得发布。
- 降级：功能关闭、无 reasoning、超时、模型错误、Run 预算和并发上限均不影响主链路。
- 前端：摘要按 revision 替换而非拼接，旧 execution 事件被忽略，完成自动收起，
  失败保持展开。

## 独立内容呈现策划专项验证（规格 023）

### 契约与安全

- `UserPresentationConstraints` 只提取最新 Turn 的颜色、禁用色、使用范围、装饰、图片展示和品牌要求。
- `PresentationStyleDecision` 必须携带当前 `structureVersion`、schema version、来源、置信度和安全 evidence。
- visual、colorDecoration、imagePresentation 和 brandPresentation 只允许受控值。
- Presentation 和 Layout 输出均不得包含 raw HTML、CSS、脚本、对象存储内部地址或模型思维链。
- 历史 AgentOutput 缺少呈现决策时只读兼容，不回写历史 Artifact。

### 颜色优先级

- 用户明确色值、颜色名称和模糊颜色意图均可追溯到最终决策。
- 用户只指定主色时，内容只补齐辅助色、背景、深浅和使用比例，不替换颜色锚点。
- 用户禁用色不得成为 LayoutPlan 的主色、强调色、背景或大面积装饰。
- 用户未指定颜色时，主题、目标、受众、正文情绪、图片 mood 和 Skill 共同决定色彩意图。
- 用户要求与主动选择 Skill 的品牌硬约束冲突时进入 clarification，不静默覆盖。
- 对比度无法满足时返回明确错误，不创建 Artifact。

### 节点职责与回退

- Presentation Director 不修改标题、正文、章节集合、`sectionId` 和图片语义归属。
- Layout Agent 严格映射 PresentationStyleDecision，不自行改变整体主题或颜色来源。
- Reviewer 的 `presentation` 问题回退 Presentation，`layout` 问题回退 Layout。
- 多目标问题从最上游受影响节点重跑。
- PresentationStyleDecision 与当前结构版本不一致时立即失败，不进入 Layout。

### 增量修改

- 只改颜色、装饰、视觉气质或图片展示方式时，正文和图片语义保持不变。
- 正文局部润色且密度未显著变化时可复用原呈现决策。
- 章节、内容类型、图片集合、Skill 或品牌资源变化时重跑正确的下游范围。
- 已发布 ArticleVersion 和历史 snapshot 不被回写。

### 观测与成本

- Presentation 节点产生真实 AgentTask、AgentOutput、step 和 agent 生命周期事件。
- 记录 prompt/schema version、模型配置、耗时、token、来源、theme、colorSource 和回退次数。
- 安全摘要能够说明用户颜色与内容推断的组合，不暴露完整 prompt 或 Skill。
- 新增调用受 Run deadline、取消、队列重试和唯一终态约束。

## 规范化请求与分层校验专项验证（规格 024）

### Golden 请求矩阵

- 在有成功历史、有失败历史和无历史三种状态下，覆盖完整新需求、继续、重试、正文修订、仅呈现修订和歧义请求。
- 完整新需求始终解析为 `new`，当前指令只注入一次，旧主题、旧正文和旧资源不进入执行请求。
- 明确仅改颜色、装饰、视觉、图片展示或品牌呈现时，mutation scope 只包含 `presentation`。
- 歧义请求进入 clarification，不以低置信度猜测执行。
- 重试复用冻结的失败请求；同一提示词和快照可以复现相同的 request hash 与执行边界。

### 局部执行不变量

- `creationSnapshot` 包含恢复 Presentation 路径所需的 Brief、ContentPlan、标题、提纲、正文和 ImagePlan。
- 仅呈现修订从 Presentation 开始，不调用 Brief、Planner、Title、Outline、Writer 或 ImagePlan。
- Artifact 前逐项比较标题、正文、章节顺序、`sectionId`、`structureVersion` 和图片语义；越界修改以 `MUTATION_SCOPE_VIOLATION` 失败。
- 旧 Artifact 无快照时不伪造基线，不进入局部路径。

### 语义与完整性分层

- Reviewer 对 `contentIdentity` 的实体、事实、观点和逐字要求返回 evidence、status 和 confidence。
- 创意主题或 subject 没有逐字出现只记录 `LEGACY_SUBJECT_MISMATCH` 诊断，不阻断 Artifact。
- `mustIncludeVerbatim` 缺失、标题来源错误、结构版本漂移和 mutation scope 越界仍为确定性硬失败。
- provider、quality、integrity 和 system 失败生成不同 `CreationFailureEnvelope`，并映射正确 recoverability。
