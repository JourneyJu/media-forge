# 测试方案：Creation Graph 多 Agent 编排

## 测试目标

验证 LangGraph + BullMQ 多 Agent 架构在公众号创作主链路中的正确性、可恢复性、流式反馈和最终内容边界。

本方案是目标验收门禁。当前只有 Graph、Queue/Worker 和前端事件的部分单元测试，不代表端到端主链路已通过。

## 范围

- Run 创建与队列入队。
- Redis、Worker 和 Model Gateway 健康检查。
- Worker 从 PostgreSQL 读取真实 Conversation 上下文。
- Worker 消费任务并执行 LangGraph。
- Agent 节点顺序和状态转换。
- 追问、恢复和幂等。
- RunEvent SSE 断线续传。
- Artifact 和 ArticleVersion 创建。
- 最终内容防污染。
- 标题候选生成、自动选择和标题来源校验。
- 入队 Outbox、重复消费和 Artifact 幂等。

## 不覆盖

- 模型供应商真实质量评测。
- 微信公众号真实发布。
- 大规模压测。

## 测试层级

| 层级 | 覆盖内容 |
| --- | --- |
| Contract 测试 | Graph State、AgentOutput、RunEvent schema。 |
| Unit 测试 | 单个 node、Title policy、Artifact Builder、clarification policy。 |
| Integration 测试 | `POST /runs` → queue → worker → events → artifact。 |
| API 测试 | 追问提交、任务列表、事件流。 |
| UI 测试 | 对话流、任务卡、手机预览更新。 |

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
- Worker 读取的是当前 Conversation 上下文。

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
