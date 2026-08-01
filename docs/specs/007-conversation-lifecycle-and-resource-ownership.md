# 会话生命周期与资源归属规格

## 目标

本规格定义用户可见创作空间、历史会话、消息、上传资源和删除之间的唯一产品模型，消除默认工作空间、空会话记录和资源归属不清。

## 核心定义

- 用户可见的“创作空间”就是 `Conversation`。
- 未发送的空会话是浏览器本地草稿状态，不是后端实体。
- Conversation 只有在首次用户请求成功写入后才存在。
- Conversation 是消息、资源、Run、Artifact、Article 和快照的删除聚合根。
- 消息只追加，不支持消息级修改或删除。

机构、门店或品牌资料属于账户级上下文，不出现在历史会话列表，也不通过默认 Conversation 表达。

## 产品状态

### 页面初始状态

```text
conversationId = null
messages = []
draftText = ""
stagedResources = []
```

每次进入创作页均进入该状态。加载历史列表不改变当前空会话，只有用户主动点击历史项才恢复对应 Conversation。

### Conversation 状态

```text
active
deleting
```

- `active`：可读取和追加 Turn。
- `deleting`：从用户列表隐藏，等待对象和数据库聚合清理，不允许继续写入。

不使用持久化的 `draft` 或“默认工作空间”状态。

## 创建与排序规则

1. 首次发送成功时创建 Conversation 和首条用户消息。
2. `title` 等于首条用户 prompt 原文。
3. `created_at` 等于首次请求的服务端事务时间。
4. `last_interaction_at` 初始等于 `created_at`。
5. 后续用户 Turn 成功后更新 `last_interaction_at`。
6. AI 消息、RunEvent、Worker 状态、Artifact 和预览更新不得修改 `last_interaction_at`。
7. 历史列表按 `last_interaction_at DESC, id DESC` 稳定排序。

前端可对标题做单行省略，但不得用摘要覆盖数据库中的首条 prompt。

## 上传资源规则

### 暂存

资源选择或粘贴后立即上传到 Service，再由 Service 流式写入 MinIO / S3。上传时通过 `UploadSession` 归属当前用户，不创建 Conversation。

```text
UploadSession(active)
  └─ Resource(staged)
```

暂存资源：

- 可以在发送前移除。
- 只在当前前端编辑生命周期内可重试查询；退出或重新进入创作页不自动恢复。
- 默认 24 小时过期。
- 过期后由后台任务删除对象和元数据。
- 不出现在历史会话列表。

### 发送绑定

首次或后续 Turn 成功时，Resource 从 `staged` 变为 `attached`，同时写入：

```text
resource.conversation_id
message_resources.message_id
message_resources.resource_id
```

发送后的 Resource：

- 只能属于一个 Conversation。
- 只能通过所属 Conversation 读取。
- 不支持从消息单独解绑或删除。
- 随 Conversation 删除。

### 消息展示

用户消息保存 `content`，资源通过 `message_resources` 查询。前端最多显示 4 张 `44 × 44` 缩略图，剩余资源显示 `+N`，查看层展示全部资源。

## 原子 Turn

### 首次 Turn

```text
POST /conversations
{
  idempotencyKey,
  content,
  uploadSessionId?,
  resourceIds[],
  layoutSkillId
}
```

一个数据库事务必须同时完成：

- 创建 Conversation。
- 创建首条用户 Message。
- 绑定本次 Resources。
- 创建 queued Run。
- 创建 Run dispatch outbox。
- 消费 UploadSession。

任一步失败时不得留下历史 Conversation。

### 后续 Turn

```text
POST /conversations/:conversationId/turns
```

一个数据库事务必须同时完成：

- 校验 Conversation 为 active。
- 追加用户 Message。
- 绑定本次 Resources。
- 递增 `context_version`。
- 更新 `last_interaction_at`。
- 创建 queued Run 和 dispatch outbox。

同一个 `idempotencyKey` 重试返回原结果，不重复写消息或 Run。

## AI 消息和任务事件

- Assistant 的可见文字通过 `assistant.message.delta` 流式展示。
- 流完成后保存一条不可变 Assistant Message。
- 流式增量持久化到 `run_events`，用于断线续传。
- 多 Agent 任务进度继续作为对话中的任务卡投影，不进入文章正文。
- 追问回答作为新的用户 Turn 或结构化 clarification 记录追加，不能修改旧消息。

## 删除规则

### 删除范围

删除 Conversation 必须覆盖：

- ConversationMessage 和 MessageResource。
- Resource 元数据、原图、预览图和识别快照。
- Run、RunEvent、AgentTask、AgentOutput 和 checkpoint。
- Artifact、Article、ArticleVersion、HTML 和 prompt 快照。
- 与该 Conversation 独占关联的其他派生数据。

### 删除流程

1. Service 校验所有权并锁定 Conversation。
2. 将状态改为 `deleting`。
3. 将待删对象 key 固化到 `conversation_deletion_outbox`。
4. API 返回 `202`，Conversation 立即从列表隐藏。
5. Worker 幂等删除 MinIO 对象。
6. Worker 在 PostgreSQL 中硬删除 Conversation 聚合和 Outbox。
7. 失败按退避策略重试并记录安全错误摘要。

不提供 Message、attached Resource、Run 或 Artifact 的独立删除入口。

## 数据不变量

- 后端不存在无用户消息的 Conversation。
- 历史列表只返回 `active` Conversation。
- 首条用户 Message 与 Conversation 使用相同创建事务。
- Message 创建后内容不可更新。
- attached Resource 只能归属一个 Conversation。
- MessageResource 的 Message 和 Resource 必须属于同一 Conversation。
- `last_interaction_at` 只能由用户 Turn Service 更新。
- Redis 不是 Conversation、Message、Resource 或删除状态的事实源。

## 兼容与迁移

- 旧 `POST /conversations` 空壳创建方式进入弃用期。
- 旧 `POST /conversations/:id/messages`、`/resources`、`/runs` 不再作为前端主链路。
- 旧 `workspaceId=default-workspace` 不再用于产品语义。
- 旧非空 Conversation 回填最后用户交互时间。
- 旧空 Conversation 在备份和审计后清理，不迁移为历史记录。
- 旧资源没有真实对象时显示“历史资源不可用”，不伪造图片。

## 验收标准

- 进入页面时数据库不会新增 Conversation。
- 退出后重新进入仍显示新的本地空会话。
- 首次发送后历史列表新增一条，标题为首条 prompt。
- 历史创建时间为首次发送时间。
- 对历史会话再次发送后，该会话回到列表第一条。
- AI 运行或完成不会单独改变历史排序。
- 上传完成后对象已存在；退出或重新进入仍展示新的空会话，旧 staged Resource 由 TTL 清理。
- 发送后资源和用户消息显示在同一消息气泡中。
- 超过 4 张资源只展示前 4 张和准确的 `+N`。
- 已发送消息和资源不能单独删除。
- 删除 Conversation 后其全部业务数据和对象最终被清理。
