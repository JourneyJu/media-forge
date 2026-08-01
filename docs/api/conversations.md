# API：创作会话与任务

## 模块文档

- `docs/modules/conversations/README.md`

## 状态

本文描述目标契约。正式实现前需先更新 `packages/contracts/src/conversations.ts`。旧的空 Conversation 创建和分段 Message / Resource / Run 写入接口在迁移期保留，但不再作为前端主链路。

## 权限与幂等

- 所有接口从登录态读取 `ownerId`，不接受前端伪造 owner。
- 用户只能访问自己的 Conversation、Resource、Run 和 Artifact。
- 写接口必须携带 `idempotencyKey`。
- 无权限资源统一返回 404，避免泄露存在性。

## `POST /conversations`

首次用户 Turn。原子创建 Conversation、首条用户 Message、资源关系、queued Run 和 dispatch outbox。禁止创建空 Conversation。

### 请求

```json
{
  "idempotencyKey": "01J4-client-request-id",
  "content": "写一篇儿童摄影活动公众号文案，面向家长，风格温暖。",
  "uploadSessionId": "upload_session_1",
  "resourceIds": ["resource_1", "resource_2"],
  "layoutSkillId": "auto"
}
```

### 响应 `201`

```json
{
  "conversation": {
    "id": "conversation_1",
    "title": "写一篇儿童摄影活动公众号文案，面向家长，风格温暖。",
    "status": "active",
    "contextVersion": 1,
    "createdAt": "2026-07-27T10:32:00.000Z",
    "lastInteractionAt": "2026-07-27T10:32:00.000Z"
  },
  "message": {
    "id": "message_1",
    "role": "user",
    "content": "写一篇儿童摄影活动公众号文案，面向家长，风格温暖。",
    "resources": [
      {
        "id": "resource_1",
        "previewUrl": "/resources/resource_1/preview"
      }
    ],
    "createdAt": "2026-07-27T10:32:00.000Z"
  },
  "run": {
    "id": "run_1",
    "status": "queued"
  }
}
```

重复 `idempotencyKey` 返回原结果，不重复创建 Conversation。

## `POST /conversations/:conversationId/turns`

向 active Conversation 追加用户 Turn，并原子创建 Message、资源关系、Run / Outbox，递增 `contextVersion` 和更新 `lastInteractionAt`。

请求字段与首次 Turn 相同，但 `uploadSessionId` 可选。响应返回 Message、Run 和新的 `lastInteractionAt`。

Worker、Assistant 消息和 Artifact 更新不得调用该接口，也不得更新 `lastInteractionAt`。

## `GET /conversations`

读取真实历史列表。页面进入时可以加载列表，但前端不得自动激活第一条。

### 查询

| 参数 | 说明 |
| --- | --- |
| `cursor` | 可选，游标分页。 |
| `limit` | 默认 30，最大 100。 |

### 排序

```text
last_interaction_at DESC, id DESC
```

只返回 `active` 且至少有一条用户消息的 Conversation。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "conversation_1",
      "title": "写一篇儿童摄影活动公众号文案，面向家长，风格温暖。",
      "createdAt": "2026-07-27T10:32:00.000Z",
      "lastInteractionAt": "2026-07-27T10:32:00.000Z"
    }
  ],
  "nextCursor": null
}
```

没有会话时返回 `items: []`，不返回默认或演示数据。

## `GET /conversations/:conversationId`

返回 Conversation 恢复视图：

```text
conversation
messages（每条包含 resources）
activeRun
latestArtifacts
```

Message 和 MessageResource 按创建顺序返回。

## `PATCH /conversations/:conversationId`

可选的显式重命名接口。只允许修改 `title`，不更新 `lastInteractionAt`。默认标题仍为首条 prompt；前端不应自动摘要覆盖。

## `DELETE /conversations/:conversationId`

删除整个 Conversation 聚合。

### 响应 `202`

```json
{
  "conversationId": "conversation_1",
  "status": "deleting"
}
```

Service 在同一事务中标记 `deleting` 并创建 deletion outbox。历史列表立即隐藏，Worker 后续删除对象和数据库聚合。重复删除返回相同状态。

## Run 与追问

```text
GET  /runs/:runId
GET  /runs/:runId/events
POST /runs/:runId/clarifications
GET  /conversations/:conversationId/artifacts
GET  /artifacts/:artifactId
```

SSE 支持 `after` 或 `Last-Event-ID`。事件只包含可展示摘要，不包含模型原始思维链、密钥、完整 prompt 或未脱敏输出。

## 弃用接口

```text
POST /conversations/:id/messages
POST /conversations/:id/resources
POST /conversations/:id/runs
GET  /workspaces/:workspaceId/conversations
```

兼容期只服务旧客户端。新前端必须使用原子首次 Turn 和后续 Turn API。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在或无权限。 |
| `CONVERSATION_DELETING` | 409 | 会话正在删除，不允许继续写入。 |
| `CONVERSATION_EMPTY_NOT_ALLOWED` | 422 | 试图创建无首条用户消息的会话。 |
| `TURN_DUPLICATED` | 200 / 201 | 幂等键重复，返回原结果。 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在或无权限。 |
| `RESOURCE_NOT_STAGED` | 409 | 资源不是可绑定暂存状态。 |
| `RESOURCE_CONVERSATION_CONFLICT` | 409 | 资源已属于其他会话。 |
| `RUN_NOT_FOUND` | 404 | Run 不存在或无权限。 |
| `RUN_INVALID_STATE` | 409 | Run 状态不允许操作。 |
| `WORKER_UNAVAILABLE` | 503 | 队列或 Worker 暂不可用。 |
