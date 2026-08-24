# ADR 014：使用 Agent 旁路摘要器生成安全分析动态

## 状态

Accepted。

## 日期

2026-08-24

## 背景

MediaForge 使用 LangGraph + BullMQ 执行多 Agent 公众号创作。ADR 011 已决定不向用户透传或持久化供应商原始思维链，而是通过产品级 RunEvent 展示安全阶段、固定业务摘要、校验、重试和心跳。该边界已经避免系统 Prompt、Skill 指令、隐私、内部参数和未校验输出进入浏览器。

现有固定摘要能够证明 Agent 仍在运行，但不同任务的过程反馈高度相似，不能充分解释当前 Agent 正在观察、比较、规划或检查什么。产品同时需要当前 Agent 在执行时展开过程，Agent 完成后立即收起临时内容。

直接透传原始 `reasoning_content` 风险不可接受；把摘要器建成新的 LangGraph Agent 又会污染业务编排、增加失败路径并使过程展示影响最终产物。需要一种不改变业务事实源和主执行状态的旁路机制。

## 决策

1. 延续 ADR 011 的核心安全边界：不展示、不持久化、不记录供应商原始思维链。
2. 每次符合条件的业务 Agent 模型调用旁挂非阻塞 `ReasoningObserver`，而不是新增 LangGraph 节点。
3. 原始 reasoning 只进入 Worker 内存中的有界缓冲区，在 Agent 完成、失败、取消或重试时立即清空。
4. Observer 只对长耗时、支持 reasoning 且未超过预算的 Agent 调用轻量摘要模型；短节点和旁路不可用时使用确定性进度。
5. 首期摘要调用复用主模型所属的同一模型连接和供应商，禁止默认跨供应商转发 reasoning。
6. 摘要前后分别执行确定性安全检查；摘要模型返回受控结构，由服务端模板生成展示文案，不直接自由输出最终 UI 文本。
7. 摘要器不访问工具、数据库、对象存储、网络资源、完整 RunContext 或未校验模型 `content`。
8. 摘要调用完全旁路，不得阻塞主模型 stream、AgentOutput 校验和 Artifact 持久化；摘要失败不改变 Agent 或 Run 状态。
9. 使用 `runId + stepId + agentName + attemptNo + executionId` 作为执行围栏。Agent 终态或身份变化后，所有晚到摘要必须丢弃。
10. 新增完整替换语义的 `agent.reasoning.summary` 产品事件，不复用可拼接的 `agent.reasoning.delta`。
11. 通过安全检查的摘要可以写入现有 PostgreSQL RunEvent 事实源以支持 SSE 回放；原始 reasoning 永不进入 RunEvent。
12. 前端只在 Agent `running` 期间展示分析动态。Agent 完成后自动收起并清除临时展示，只保留由已验证输出生成的完成摘要；失败 Agent 保持展开。
13. 首期默认关闭并使用 Shadow 模式验证安全、延迟、成本、拒绝率和晚到率，再按 Agent 类型和用户范围灰度。
14. 首期不新增模型路由和数据库字段。独立 `reasoning_summary` 路由、调用用途和成本字段属于后续 L 级演进，必须另立 `.plan/` 并人工确认。

## 选择理由

- Observer 与业务 Agent 解耦，旁路失败不会破坏 Graph 状态、Artifact 和 Run 终态。
- 内存有界、零原文持久化和同供应商约束降低 reasoning 扩散范围。
- 受控结构、平台模板和双层安全校验比直接展示原始或自由文本摘要更可控。
- 完整摘要事件比 token 级持久化显著减少 PostgreSQL 写入和 SSE 回放压力。
- execution fence、取消和前端终态防护可以控制重试、Graph 回退和晚到响应竞态。
- 资格门禁、每 Agent/Run 预算和确定性回退可以限制多 Agent 架构带来的调用成本。
- 复用现有 Model Gateway、RunEvent 和 SSE，首期不改变服务边界或引入新基础设施。

## 与 ADR 011 的关系

本 ADR 扩展但不取代 ADR 011。

ADR 011 继续定义以下不可变边界：

- 不透传供应商原始 reasoning。
- 浏览器不直接连接模型供应商。
- 结构化 `content` 完整缓冲并通过 schema 后才能成为业务输出。
- PostgreSQL RunEvent + SSE 是产品进度回放链路。

本 ADR 只把“reasoning 作为活跃信号后映射固定摘要”扩展为“在严格安全、预算和生命周期边界下，可以由旁路模型生成任务相关的安全摘要”。如果本 ADR 未被接受或功能开关关闭，系统继续执行 ADR 011 的确定性进度方案。

## 备选方案

### 直接透传原始 reasoning

实时感最强，但可能泄露 Prompt、Skill、隐私、内部参数和未验证判断，不同供应商语义也不一致。拒绝。

### 继续只使用固定阶段文案

成本和风险最低，也是必要的降级路径，但不能提供任务相关的观察、比较和规划信息。作为 fallback 保留，不作为目标体验。

### 让主 Agent 在结构化输出中附带过程数组

可以减少额外模型调用，但字段到达顺序不保证实时，过程数据可能污染业务 schema，并诱导模型在最终 JSON 中伪造预先编排的“实时过程”。拒绝作为主方案。

### 把摘要器建成新的 LangGraph Agent

可显式编排和持久化，但会让过程展示进入业务图、增加失败与恢复状态，并可能影响 Artifact 完成时间。拒绝。

### 对所有 Agent 持续调用摘要模型

信息最丰富，但会在多 Agent 架构中放大调用次数、延迟、限流和成本，很多摘要还会在节点完成后晚到。拒绝；只对长 Agent 按资格和预算调用。

### 使用 WebSocket 或新消息基础设施

过程仍是服务器单向推送，现有 SSE 已支持认证、顺序和断线回放。没有必要改变基础设施。拒绝。

### 摘要不落库，仅通过瞬时 SSE 推送

可以减少持久化，但刷新和断线后无法恢复当前 Agent，并与现有 RunEvent 回放链路分裂。首期拒绝；只持久化通过安全校验的完整摘要。

## 影响

- 共享事件契约需要增加 `agent.reasoning.summary` 及完整摘要 Payload。
- Model Gateway 需要提供可取消、低温度、严格结构化的旁路摘要调用。
- Worker 需要增加有界缓冲、资格门禁、安全策略、预算、单飞和 execution fence。
- 前端需要采用摘要替换语义，并实现阶段级自动展开、完成收起和终态事件防护。
- 现有固定业务摘要、phase、heartbeat 和非流式降级继续保留。
- 安全摘要事件会增加少量 RunEvent 写入，但每 Agent 限制为 1～2 条，不持久化 token delta。
- 运维需要独立的无文本指标、功能开关、Shadow 模式和全局熔断。

## 风险与应对

- 敏感信息泄露：同供应商、内存有界缓冲、输入/输出双层检查、零文本日志、P0 命中熔断。
- 摘要失真：受控结构、平台模板、进行时语义、数字与实体一致性校验，不把摘要作为业务事实源。
- Prompt 注入：reasoning 作为不可信数据，摘要器无工具权限，严格 schema，恶意样本门禁。
- 主链路性能下降：完全异步、独立并发、短超时、零重试，主链路不等待旁路。
- 晚到响应：完整执行身份、AbortController、终态关闭、服务端与前端双层丢弃。
- 成本放大：仅长 Agent、每 Agent/Run 硬预算、首期只开放三个 Agent、达到预算自动降级。
- 供应商差异：Gateway 能力声明；无 reasoning 或格式不兼容时回退确定性动态。
- 用户误解：界面使用“分析动态·由系统整理”，不声称展示完整或原始思维链。

## 实施与回滚

首期实施顺序为：契约和文档 → 安全策略 → Observer → Gateway → Worker → 前端 → Shadow → 灰度。

回滚不需要迁移数据：关闭 `REASONING_SUMMARIZER_ENABLED` 后停止新摘要调用和事件，客户端继续使用现有 `agent.progress`、heartbeat 和终态事件。老客户端忽略未知摘要事件，历史安全摘要保留为 RunEvent，但完成阶段不再展示。

## 关联

- `docs/specs/021-agent-reasoning-sidecar-summary.md`
- `docs/specs/016-streaming-agent-progress.md`
- `docs/adr/011-safe-agent-reasoning-stream.md`
- `docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
- `docs/modules/creation-graph/README.md`
- `docs/modules/chat-workspace/README.md`
