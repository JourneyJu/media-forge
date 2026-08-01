# 架构总览

## 总体结构

MediaForge 采用独立认证服务 + 后端 API 服务 + 前端 Web + 独立 Worker + 共享契约 + 本地基础设施的方式运行。

```text
apps/web
  → packages/contracts
  → apps/auth
      → PostgreSQL
      → Redis
  → apps/service
      → apps/auth / JWKS
      → PostgreSQL
      → MinIO
      → Redis
      → Model Gateway
  → apps/worker
      → apps/auth / service credential
      → PostgreSQL
      → Redis / BullMQ
      → Model Gateway
      → MinIO
```

## 核心设计决策

1. PostgreSQL 是业务事实数据源。
2. MinIO / S3 保存图片、HTML 快照、Markdown、prompt 快照和 skill 包。
3. 正式文章版本必须保存 `content_json` 和 HTML 快照。
4. AI 生成、图片识别、导出和记忆总结应通过异步任务执行。
5. 排版 skill 需要版本化，文章版本记录 `skill_pack_version` 和 `renderer_version`。
6. 品牌长期记忆只保存摘要，不把所有历史聊天直接塞给模型。
7. 微信公众号第一版不直接发布，只提供微信兼容 HTML 复制能力。
8. 模型供应商调用统一经过 `apps/service` 的 Model Gateway adapter，前端不得配置或保存模型 API Key。
9. 用户、`admin/user` 角色、登录会话和 token 由独立 `apps/auth` 负责；产品层没有租户概念，业务服务只消费 `AuthContext`。
10. 第一阶段只支持账号密码登录，默认 bootstrap 一个必须改密的 `admin` 账户；生产环境不得使用硬编码默认密码。
11. 密码使用 Argon2id 不可逆哈希保存，access token 使用非对称签名，refresh token 只保存 hash 并启用轮换。
12. 当前创作上下文以 `Conversation` 为边界，Run 只能读取当前会话内消息、资源和产物摘要。
13. 公众号 Run 由 `apps/service` 创建并入队，由独立 `apps/worker` 中的可持久化 LangGraph Orchestrator 推进；模型不能自行推进状态或决定无限循环。
14. 前端只展示结构化计划、步骤摘要、问题和结果，不展示模型原始思维链。
15. 用户可见的创作空间就是 `Conversation`；未发送的空窗口只存在于前端，不创建默认或空会话。
16. Conversation 只有在首次用户请求成功时创建，历史排序只由成功用户 Turn 更新。
17. Conversation 是消息、资源、Run、Artifact、Article 和对象快照的删除聚合根。
18. 模型连接、模型能力和默认路由以 PostgreSQL 为唯一事实源，业务模型不从环境变量读取。
19. 生成次数和真实模型调用分别记账，token 只采用供应商返回值。

## 当前实现状态

异步多 Agent 主链路已接通：

- Conversation Run 创建后写 PostgreSQL 和 Outbox，并投递 BullMQ。
- 独立 `apps/worker` 从 PostgreSQL 加载真实上下文并执行 LangGraph。
- Worker 在节点执行期间写入 AgentTask、AgentOutput 和 RunEvent。
- Title、Review、Revision 和 Artifact Guard 使用结构化契约。
- 前端通过 SSE 展示助手消息、Agent 阶段和追问，刷新后可恢复。
- 系统设置已实现用户管理、模型配置和使用监控三个管理页面。
- AI 运行时按 `text_generation` / `multimodal_generation` 从数据库解析 active 模型。

当前未完成的是 LangGraph 原生 PostgreSQL checkpoint、Redis Pub/Sub 通知和 MinIO 脱敏快照；详见 `docs/specs/006-langgraph-multi-agent-production-completion.md`。

## Conversation-first 创作链路

后端产品化主线采用 conversation-first 架构：

```text
前端本地空会话（无 ID、无后端记录）
  → 首次用户 Turn
    → Conversation
    → ConversationMessage / MessageResource
    → Run
      → RunStep / RunDecision
      → Artifact
        → ArticleVersion
```

边界规则：

- `Conversation` 是用户可见创作空间、历史记录和当前创作上下文边界。
- 首次 Turn 原子创建 Conversation、用户 Message、资源关系、Run 和 dispatch outbox。
- 资源在 Conversation 创建前通过 `UploadSession` 暂存到 PostgreSQL 和 MinIO / S3。
- `last_interaction_at` 只在用户 Turn 成功后更新，Worker 和 AI 输出不得改变历史排序。
- Conversation 删除通过删除 Outbox 清理完整聚合和对象存储。
- `Run` 是一次 AI 执行任务边界。
- `Artifact` 是任务结果边界。
- `ArticleVersion` 是公众号文章可恢复边界。
- 品牌长期记忆只以摘要方式显式进入当前会话，不产生默认 Conversation。

基础规格见 `docs/specs/002-conversation-first-creation-system.md`；本次生命周期修订以 `docs/specs/007-conversation-lifecycle-and-resource-ownership.md` 为准，实施计划见 `.plan/20260727-conversation-lifecycle-resource-ownership.md`。

## 微信公众号生成主链路

```text
apps/web 公众号生成工作台
  → apps/service AI 生成入口
    → 读取 workspace、assets、layout_skill_packs、workspace_memories
    → Model Gateway 生成结构化 ArticleDocument
    → WeChat Renderer 生成微信兼容 HTML
    → article_versions 保存 content_json 和 HTML 快照 key
    → MinIO / S3 保存 HTML、prompt 和渲染元数据快照
```

微信兼容 HTML 由 renderer 输出，要求使用保守标签和内联样式。前端预览是模拟效果，复制导出以 renderer 生成的 HTML 为准。

## Agent 编排主链路

```text
apps/web 在 Conversation 内创建 Run
  → apps/service 创建 queued Run 和 dispatch outbox
  → Redis / BullMQ creation-run queue
  → apps/worker 读取当前 Conversation 上下文
    → Brief Agent 生成 CreativeBrief
    → Clarification Policy 判断是否追问
    → Title Agent 生成并自动选择标题候选
    → Outline Agent 生成故事和商业结构
    → Writer Agent 生成结构化 ArticleDraft
    → Image Planner 规划封面、正文图和组图
    → Reviewer Agent 输出 ReviewReport
    → Revision Policy 决定 revise / failed / render
    → Artifact Builder 校验内容边界并创建 ArticleVersion
    → WeChat Renderer 输出最终 HTML
  → apps/service 通过持久化 RunEvent SSE 推送进度
  → apps/web 更新对话任务卡和手机预览
```

PostgreSQL 保存 `conversations`、`conversation_messages`、`message_resources`、`resources`、`runs`、`agent_tasks`、`agent_outputs`、`run_events`、`artifacts` 和文章版本。Redis 只承担队列、锁、重试和短期通知。Prompt 与模型原始输出经脱敏后保存到 MinIO / S3，用于审计和复现。

## 后续演进

当业务复杂度增加后，可以从 `apps/service` 拆分出独立服务：

- AI Agent Service：负责模型网关、prompt 编排、生成任务。
- Asset Service：负责上传、图片识别、缩略图。
- Export Service：负责微信 HTML renderer 和导出。

拆分服务边界属于 L 级变更，必须先写 ADR 并人工确认。

## 模块路由

架构文档只维护系统级边界和路由。涉及具体模块时，进入模块文档继续维护。

| 架构领域 | 模块文档 | API 文档 | 测试方案 |
| --- | --- | --- | --- |
| 品牌上下文和长期记忆 | `docs/modules/workspaces/README.md` | `docs/api/workspaces.md` | `docs/testing/plans/workspaces.md` |
| 创作会话、任务和产物 | `docs/modules/conversations/README.md` | `docs/api/conversations.md` | `docs/testing/plans/conversations.md` |
| 多 Agent 创作编排 | `docs/modules/creation-graph/README.md` | `docs/api/creation-graph.md` | `docs/testing/plans/creation-graph.md` |
| 图片素材和识别 | `docs/modules/assets/README.md` | `docs/api/assets.md` | `docs/testing/plans/assets.md` |
| 文章、版本和快照 | `docs/modules/articles/README.md` | `docs/api/articles.md` | `docs/testing/plans/articles.md` |
| 排版 skill 和 renderer | `docs/modules/layout-skills/README.md` | `docs/api/layout-skills.md` | `docs/testing/plans/layout-skills.md` |
| AI 生成和模型网关 | `docs/modules/ai-generation/README.md` | `docs/api/ai-generation.md` | `docs/testing/plans/ai-generation.md` |
| 认证、用户和权限 | `docs/modules/auth/README.md` | `docs/api/auth.md` | `docs/testing/plans/auth.md` |
| 管理后台、模型配置、使用监控 | `docs/modules/admin/README.md` | `docs/api/admin.md` | `docs/testing/plans/admin.md` |

## 架构文档变更规则

如果架构变更影响某个模块，必须同步：

1. 对应 `docs/modules/{module}/README.md`。
2. 对应 `docs/api/{module}.md`。
3. 对应 `docs/testing/plans/{module}.md`。
4. 对应 `docs/testing/cases/{module}.md`。

如果架构变更只影响全局原则或服务边界，必须补 ADR。
