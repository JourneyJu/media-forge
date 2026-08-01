# ADR 004: LangGraph + BullMQ 多 Agent 商用架构

## 状态

Accepted

## 实施状态

架构决策已接受，但目标链路尚未完整实现。

当前仓库已经存在 LangGraph、BullMQ、Redis 配置、Worker 骨架和前端任务卡；Conversation Run 主入口仍调用旧同步 `agent-runs`，尚未完成 Run 入队、真实上下文加载、AgentOutput 持久化、实时跨进程事件和 Artifact Guard。

当前实现缺口和生产化补全边界见：

- `docs/specs/006-langgraph-multi-agent-production-completion.md`
- `.plan/20260727-langgraph-multi-agent-production-completion.md`

本文记录长期架构决策，不将目标态描述为当前已交付能力。

## 背景

公众号创作从单 Agent 自动执行升级为多 Agent 协作。系统需要在商业化场景下支持真实会话、长任务、任务恢复、素材处理、文章版本、手机预览和后续扩展。用户不确认内部执行计划，只在信息不足时被追问。

候选方案：

- B：`LangGraph.js + BullMQ Worker`。业务 API、任务队列和多 Agent 执行由项目自有服务掌控。
- C：`LangGraph Agent Server / Platform`。使用 LangGraph 原生 Agent Server 承载 threads、runs、queue、persistence 和 streaming。

## 决策

采用 **B：LangGraph.js + BullMQ Worker**。

系统形态：

```text
apps/web
→ apps/service
  → Conversation API
  → Run API
  → RunEvent SSE
  → Artifact API

→ Redis / BullMQ
  → creation-run queue

→ apps/worker
  → LangGraph 多 Agent runner

→ PostgreSQL
  → 业务事实表
  → LangGraph checkpoint 表

→ MinIO / S3
  → 上传素材、HTML snapshot、prompt/raw output 脱敏快照
```

LangGraph 只作为多 Agent 编排引擎，不替代产品业务模型。产品事实源仍然是：

```text
Conversation
ConversationMessage
Run
RunEvent
AgentTask
AgentOutput
Artifact
ArticleVersion
```

## 选择理由

- 产品数据模型由 MediaForge 自己掌控，避免 LangGraph Server 的 `threads / runs / assistants` 与业务表形成双事实源。
- Worker 可以横向扩容，适合真实用户的长任务和并发生成。
- `apps/service` 保持权限、套餐、素材、文章版本、SSE 和 API 的统一入口。
- LangGraph 可以后续替换、升级或迁移，不会反向绑死业务层。
- 相比 Agent Server，部署和排障复杂度更可控。

## 不采用 C 的原因

暂不采用 LangGraph Agent Server / Platform 作为第一阶段运行时，原因是：

- 它会引入另一套 Agent 服务模型，需要映射到现有 `Conversation / Run / Artifact`。
- 当前更需要稳定产品闭环，而不是托管 Agent 平台能力。
- 自托管 Agent Server 仍需要数据库、队列、服务治理和部署维护。
- 后续如果 Agent 调试、可视化和运维复杂度显著上升，可以再评估引入 C。

## 多 Agent 结构

```text
Orchestrator Agent
├─ Brief Agent
├─ Clarification Agent
├─ Title Agent
├─ Outline Agent
├─ Writer Agent
├─ Image Planner Agent
├─ Reviewer Agent
├─ Revision Agent
└─ WeChat Renderer Agent
```

规则：

- 只有 Orchestrator 可以推进 Run 状态。
- 专业 Agent 只产出结构化结果，不直接写最终公众号正文。
- Artifact Builder 是唯一能创建最终 `Artifact` / `ArticleVersion` 的入口。
- `decision.required` 只用于必要追问或异常恢复，不用于计划确认。
- 最终公众号内容不得包含用户原始输入、执行计划、Agent 过程、模型思考或审阅说明。

## 影响

- 新增 `apps/worker`，用于消费 BullMQ 队列并执行 LangGraph。
- `apps/service` 新增创建队列任务和订阅 RunEvent 的职责。
- PostgreSQL 新增多 Agent 执行记录和 LangGraph checkpoint。
- Redis 成为生产运行依赖，用于 BullMQ 队列、重试、延迟任务和并发控制。
- 前端中间区域改为“对话流 + 多 Agent 任务卡 + 底部输入框”。

## 后续

- 落地规格见 `docs/specs/004-langgraph-multi-agent-creation-system.md`。
- 生产化补全规格见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。
- 模块文档见 `docs/modules/creation-graph/README.md`。
- 初始实施计划见 `.plan/20260727-langgraph-multi-agent.md`。
- 当前补全计划见 `.plan/20260727-langgraph-multi-agent-production-completion.md`。
