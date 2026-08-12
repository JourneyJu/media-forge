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

结构一致性测试应覆盖 `sectionId` 和 `structureVersion` 在 ContentPlan、Outline、Draft、ImagePlan、LayoutPlan 与 ArticleDocument 之间的完整传递。标题文本变化不应改变章节身份；增删、换序、重复 ID、未知引用和过期版本必须在责任节点后的 Structure Guard 被发现。

模型输出纠错测试需要区分两类重试：schema/结构格式纠错不消耗内容 Revision 次数，Review 引发的内容修订按现有修订上限计数。历史兼容测试必须验证旧 payload 只读映射和无法可靠映射时的重跑行为。

## 流式过程反馈

- Gateway 正确解析跨 chunk 的 `reasoning_content` 和 `content`。
- `content` 分片不进入前端，流结束后才执行 JSON/Zod 校验。
- reasoning 摘要经过限长和敏感内容过滤。
- 不支持 reasoning 或 stream 的模型回退到真实阶段事件，不生成伪思考。
- Worker 不持久化供应商原始 reasoning，每个 Agent 只发布平台映射的安全业务摘要。
- 5 秒无有效进度时发送 heartbeat，终态后停止。
- 首个增量慢、单 Agent 超时、Run 超时和 Worker 中断都产生明确失败或恢复结果。
- 同一个 Run 只能产生一个业务终态。

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
