# ADR 011：使用安全推理摘要和 RunEvent 展示 Agent 实时过程

## 状态

Accepted。

## 日期

2026-08-03

## 背景

多 Agent 模型调用可能长时间没有可见输出，节点级开始/完成事件不足以证明任务仍在执行。直接展示模型原始思维链会泄露系统 prompt、Skill 规则、隐私和安全策略，且不同模型对 reasoning 的支持不一致。

## 决策

1. 不展示、持久化或对外承诺模型原始思维链。
2. `reasoning_content` 只作为模型活跃信号，展示平台映射的安全业务摘要和真实执行阶段，不透传供应商原文。
3. 模型流式内容由 Worker 转换为产品级 `RunEvent`，浏览器不直接连接模型供应商。
4. 继续使用 PostgreSQL RunEvent + SSE + `Last-Event-ID`，不引入 WebSocket 或新的消息基础设施。
5. 结构化 Agent 输出在服务端完整缓冲和 Zod 校验，残缺 JSON 不进入前端或 Artifact。
6. 完成后折叠全部 Agent 过程；失败节点保持展开并产生明确终态。
7. 不支持 reasoning 的模型使用确定性阶段进度，不伪造模型思考。

## 选择理由

- 保持浏览器、Service、Worker 和模型供应商之间的现有安全边界。
- RunEvent 已具备持久化、顺序和断线续传能力。
- 阶段事件比原始思维链更稳定、更可测试，也更适合普通用户理解。
- 服务端缓冲结构化 JSON可以维持现有 Artifact 事实源和 schema 门禁。

## 备选方案

### 直接透传原始 reasoning

实时感最强，但存在提示词泄露、隐私、不可控内容、体积和供应商兼容风险，不采用。

### 只发送固定 loading 文案

实现简单，但无法区分模型等待、生成、校验和重试，也不能解决静默失败，不采用。

### 使用 WebSocket

可以双向通信，但当前事件是服务器单向推送，SSE 已支持恢复和认证；新增基础设施没有必要，不采用。

## 影响

- 扩展共享 RunEvent 类型，不改变现有 SSE URL。
- Model Gateway 增加流式解析和回调。
- Worker 增加安全摘要映射、心跳和超时控制。
- Chat Workspace 增加 Agent 过程状态和自动折叠。
- 默认复用 `run_events`，不新增生产依赖。

## 风险与应对

- 推理摘要仍可能包含敏感信息：采用 allowlist 阶段信息、规则过滤、限长和抽样审计。
- 事件写入量增长：每个 Agent 只写一次推理业务摘要，阶段变化和心跳单独限频。
- 模型流格式不一致：适配器按能力声明，无法兼容时回退非流式阶段事件。
- Worker 中断造成 running：增加 heartbeat 和超时恢复扫描。

## 关联

- `docs/specs/016-streaming-agent-progress.md`
- `docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
- `docs/specs/003-run-event-streaming.md`
