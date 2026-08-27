# ADR

ADR 用于记录影响长期架构的决策。

需要写 ADR 的情况：

- 服务边界变化。
- 数据库 schema 大改。
- 引入新的基础设施或外部依赖。
- 修改对象存储布局。
- 修改 AI 模型路由或长期记忆策略。

文件命名：

```text
0001-short-title.md
```

## 当前决策

| ADR | 状态 | 说明 |
| --- | --- | --- |
| `001-wechat-copy-html-and-model-gateway.md` | Accepted | 微信复制 HTML 和模型网关。 |
| `002-agent-orchestration-and-review-loop.md` | Accepted | Agent 编排与审阅循环。 |
| `003-auto-run-with-clarification-only.md` | Accepted | 自动执行，只在信息不足时追问。 |
| `004-langgraph-bullmq-multi-agent-architecture.md` | Accepted | LangGraph + BullMQ 多 Agent 架构。 |
| `005-conversation-as-creation-workspace.md` | Proposed | Conversation 作为用户可见创作空间和删除聚合根。 |
| `006-independent-auth-service-and-rbac.md` | Proposed | 独立认证服务与 RBAC 权限模型。 |
| `007-single-system-user-and-admin-role.md` | Proposed | 保留独立认证服务，将产品权限模型收敛为单系统 `admin/user` 双角色。 |
| `008-database-model-configuration-and-capability-routing.md` | Proposed | 模型连接、模型配置和默认能力路由入库，并对供应商凭据加密。 |
| `009-generation-and-model-usage-metering.md` | Proposed | 将用户生成事件与真实模型调用分离计量，支持用户和模型双维度统计。 |
| `010-structured-content-and-layout-plan.md` | Accepted | 采用结构化正文、受控 LayoutPlan 和可信 Renderer，禁止生产 Demo 回退。 |
| `011-safe-agent-reasoning-stream.md` | Proposed | 使用安全推理摘要和 RunEvent 展示 Agent 实时过程，禁止透传原始思维链。 |
| `012-shadow-dom-artifact-preview.md` | Accepted | 使用固定三栏工作台和 Shadow DOM 安全渲染固定尺寸 Artifact 手机预览。 |
| `013-stable-section-identity.md` | Accepted | 使用稳定章节身份和结构版本约束跨 Agent 内容引用。 |
| `014-agent-reasoning-sidecar-summary.md` | Accepted | 使用非阻塞旁路摘要器生成受控分析动态，并在 Agent 完成后清除展示。 |
| `015-max-review-output-last-draft.md` | Accepted | 审校达到上限时输出最后一次安全草稿，并显式标记质量提醒。 |
| `016-independent-presentation-director.md` | Accepted | 将内容呈现判断拆为独立 Presentation Director，Layout Agent 只编译受控版式。 |
