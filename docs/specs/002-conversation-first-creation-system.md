# 规格：Conversation-first 创作系统

> 修订说明：本文只保留 Conversation、Run、Artifact 和 ArticleVersion 的基础分层背景。“计划确认”已被 ADR 003 废止；会话创建时机、历史排序、资源归属和删除语义已被 `docs/specs/007-conversation-lifecycle-and-resource-ownership.md` 替代；多 Agent 执行以 `docs/specs/006-langgraph-multi-agent-production-completion.md` 为准。

## 背景

当前交互已经收敛为“左侧历史会话、中央对话输入、右侧手机预览、对话任务卡”。后端需要从单次生成请求升级为可持久化、可恢复、可扩展的创作系统，避免把会话、资源、任务、文章版本和 AI 编排继续堆叠在 `AgentRun` 或单个生成接口内。

本规格定义后续后端重构的产品化目标架构。实现前必须先完成 `.plan/20260727-conversation-first-backend.md` 的人工确认。

## 目标

- 以 `Conversation` 作为当前创作上下文边界。
- 以 `Run` 作为一次 AI 执行任务边界。
- 以 `Artifact` 作为任务产物边界。
- 以 `ArticleVersion` 作为公众号文章可恢复边界。
- 支持“输入框沟通、资源绑定、必要追问、手机预览、结果持久化”的闭环。
- 为后续追问、多轮修改、真实资源、异步任务和历史会话打基础。

## 非目标

- 第一阶段不直接接入微信公众号发布。
- 第一阶段不实现多人协作。
- 第一阶段不做 token 级流式；Run 事件流阶段使用 SSE。
- 第一阶段不把所有工作区历史自动注入当前会话。
- 第一阶段不展示模型原始思维链。

## 产品对象关系

```text
前端本地空会话（无后端记录）
  → 首次用户 Turn
  → Conversation 创作会话 / 用户可见创作空间
    → ConversationMessage 对话消息
    → MessageResource 消息资源关系
    → Run 执行任务
      → RunStep 执行步骤
      → RunDecision 用户决定
      → RunEvent 流式事件
      → Artifact 任务产物
        → Article
        → ArticleVersion
        → WeChat HTML Snapshot
```

## 领域边界

| 对象 | 职责 | 不负责 |
| --- | --- | --- |
| 品牌上下文 | 机构、门店或账号级资料、默认偏好、长期记忆 | 历史会话和单次创作上下文 |
| Conversation | 用户可见创作空间、历史记录、当前上下文和删除聚合根 | AI 具体执行步骤 |
| Message | 用户和系统可展示沟通记录 | 不保存模型原始思维链 |
| Resource | 当前会话绑定的上传、粘贴或链接资源 | 原文件存储 |
| Run | 一次 AI 任务的状态、计划、等待点和结果 | 文章版本事实源 |
| RunEvent | Run 的可恢复流式事件，用于计划条、对话状态和 artifact 通知 | 不承载原始思维链或未脱敏 prompt |
| Artifact | 一次任务输出的可展示产物 | 任务状态推进 |
| ArticleVersion | 公众号文章结构化内容和 HTML 快照 | 对话消息 |

## 数据模型

以下为早期表草案，当前目标 schema 以 `docs/architecture/database.md` 和规格 007 为准：

```text
workspaces
conversations
conversation_messages
upload_sessions
resources
message_resources
conversation_deletion_outbox
runs
run_steps
run_decisions
run_events
artifacts
articles
article_versions
```

关键字段以 `docs/architecture/database.md` 为准。实现数据库迁移前必须同步 contracts 和 API 文档。

## Run 状态机

```text
queued
→ building_brief
→ waiting_clarification（可选）
→ running
→ completed
```

任意运行态可以进入：

```text
failed
cancelled
```

状态规则：

- 只有 `waiting_clarification` 接受用户追问答案。
- `lock_version` 必须用于追问提交和任务推进冲突检测。
- 每个会改变结果的步骤必须产生 `RunStep`。
- 任务失败不得覆盖当前 `ArticleVersion`。
- 长任务后续必须通过 worker 推进，不允许长时间占用 HTTP 请求。

## AI 编排流程

```text
1. Intake
   读取当前 Conversation 的消息、资源、工作区和长期记忆摘要。

2. Brief Builder
   形成 CreativeBrief：主题、目标、读者、语气、结构、素材、约束。

3. Clarification Policy
   判断信息是否足够。只有影响结果质量的关键缺口才追问。

4. Title / Outline Agents
   生成并自动选择标题候选，形成文章结构、图片方向、正文策略和审校重点。

5. Auto Run Policy
   信息充分后自动继续执行，不要求用户确认内部计划。

6. Article Writer
   生成 ArticleDocument，不输出计划、解释或占位说明。

7. Image Planner
   规划封面图、正文图和素材组装需求。

8. Reviewer
   检查故事性、商业结构、事实风险和手机端阅读体验。

9. Renderer
   生成微信兼容 HTML。

10. Artifact Builder
   保存 Artifact、Article、ArticleVersion 和 HTML snapshot。
```

## API 目标形态

当前目标 API 以 `docs/api/conversations.md` 为准，核心写入为：

```text
POST /conversations（首次 Turn，禁止空创建）
POST /conversations/:conversationId/turns
GET /conversations
GET /conversations/:conversationId
GET /runs/:runId
POST /runs/:runId/clarifications

GET /conversations/:conversationId/artifacts
GET /artifacts/:artifactId
```

旧 `POST /agent-runs` 可作为兼容入口短期保留，但新前端应迁移到 conversation-first API。

## 前端映射

| 前端区域 | 后端对象 |
| --- | --- |
| 左侧历史会话 | `Conversation`，按最后用户交互时间排序 |
| 中央输入框 | `ConversationMessage(role=user)` |
| 上传资料 | `UploadSession` + `Resource` + `MessageResource` |
| `@ Skill` | `Run.input.layoutSkillId` |
| 首次发送 | `POST /conversations` 原子创建首次 Turn |
| 后续发送 | `POST /conversations/:id/turns` |
| 对话任务卡 | `RunEvent`、`AgentTask` 可见投影 |
| 必要追问 | `ClarificationRequest`、`RunDecision` |
| 手机预览 | `Artifact` + `ArticleVersion` |
| 当前对话上下文 | 当前 `Conversation` 内消息、资源、产物摘要 |

## 分阶段落地

### 阶段 1：真实会话闭环

- 新增 `conversations` 模块、API 文档、测试文档和 contracts。
- 创建会话、写入用户消息、创建 run。
- run 入队后自动执行多 Agent 创作。
- 信息不足时追问，信息充分后生成文章并保存 artifact。
- 页面刷新后可恢复 conversation、run 和 artifact。

### 阶段 2：追问机制

- 新增 `CreativeBrief` 和 `clarification-policy`。
- 信息不足时进入 `waiting_clarification`。
- 用户回答追问后再生成计划。

### 阶段 3：文章版本与快照

- run 完成后保存 `ArticleVersion.content_json`。
- HTML snapshot 写入 MinIO / S3。
- artifact 关联 `article_version_id`。

### 阶段 4：资源真实化

- 上传、粘贴和链接资源绑定当前 conversation。
- 图片识别摘要进入 Brief Builder。
- 资源默认不污染其他 conversation。

### 阶段 5：异步任务与事件

- 新增 `run_events`。
- `GET /runs/:id/events` 提供 SSE。
- 创建 run 后写 `run.created`。
- 本进程 async runner 推进状态，后续替换为 Redis worker。
- 前端通过事件流更新对话任务卡，收到 `artifact.created` 后更新手机预览。
- 支持失败重试、取消、幂等和断线续传。

## 验收标准

- 空工作区输入一段需求后，会创建真实 conversation、message 和 run。
- 刷新页面后，当前 run 状态不丢。
- 信息充分时自动生成 Artifact；信息不足时追问后恢复，并可在手机预览显示。
- 生成结果保存为 `ArticleVersion`，包含结构化内容和 HTML 快照 key。
- 当前 conversation 只读取自己的消息、资源和产物。
- 没有真实数据来源时，不显示假会话、假资源和假默认内容。
- 用户追问答案必须校验 `lock_version` 和幂等键。
- Run 事件必须支持断线续传，payload 不包含原始思维链、密钥或未脱敏 prompt。
- 模型输出非法结构时不保存坏版本。
- 前端不接收、不展示、不保存模型 API Key。

## 文档路由

- 架构：`docs/architecture/overview.md`、`docs/architecture/database.md`
- 模块：`docs/modules/conversations/README.md`、`docs/modules/ai-generation/README.md`、`docs/modules/articles/README.md`
- API：`docs/api/conversations.md`、`docs/api/ai-generation.md`、`docs/api/articles.md`
- 测试：`docs/testing/plans/conversations.md`、`docs/testing/cases/conversations.md`
- 实施计划：`.plan/20260727-conversation-first-backend.md`
- 流式反馈：`docs/specs/003-run-event-streaming.md`
