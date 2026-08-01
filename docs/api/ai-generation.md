# API：AI 生成

## 模块文档

- `docs/modules/ai-generation/README.md`

## 接口列表

涉及 AI 调用链路变化时，先更新 `.plan/` 或 `.workflow/` 要求的方案材料。

## 权限

生成接口必须校验工作区权限、文章权限、配额和模型配置可用性。前端不得传入模型 API Key。

## `POST /ai-generation/wechat-articles`

生成公众号文章初版。

### 请求

```json
{
  "workspaceId": "workspace_1",
  "articleId": "article_1",
  "topic": "春季招生公开课",
  "audience": "小学三到六年级家长",
  "sellingPoints": ["小班教学", "免费测评", "限时报名"],
  "callToAction": "扫码预约试听",
  "tone": "warm",
  "style": "magazine",
  "assetIds": ["asset_1", "asset_2"],
  "skillPackId": "skill_1"
}
```

### 响应 `202`

```json
{
  "jobId": "job_1",
  "articleId": "article_1",
  "status": "queued"
}
```

同步实现可以直接返回 `succeeded`，但长期契约按任务模型设计。

## `POST /ai-generation/wechat-articles/:articleId/revise`

基于当前版本和用户指令修订文章。

### 请求

```json
{
  "baseVersionId": "version_1",
  "instruction": "把标题改得更适合家长转发，并精简第三段",
  "assetIds": ["asset_1"]
}
```

### 响应 `202`

```json
{
  "jobId": "job_2",
  "articleId": "article_1",
  "status": "queued"
}
```

## `GET /ai-generation/jobs/:jobId`

查询任务状态。

### 响应

```json
{
  "jobId": "job_1",
  "status": "succeeded",
  "articleId": "article_1",
  "versionId": "version_2",
  "warnings": ["video_fallback"]
}
```

## 模型配置

模型由 `apps/service` 按请求能力从 PostgreSQL 的 `model_routes` 解析。纯文本请求使用 `text_generation`，包含图片输入的请求使用 `multimodal_generation`。缺少可用路由时返回 `GENERATION_MODEL_UNAVAILABLE`，不回退到环境变量或其他模型。任何 API 响应都不得返回密钥明文。

## 分析图片素材

```http
POST /ai/assets/analyze
Content-Type: application/json
```

```json
{
  "workspaceId": "workspace-id",
  "assetId": "asset-id",
  "imageUrl": "https://cdn.example.com/poster.jpg",
  "purpose": "poster"
}
```

接口只接受 HTTPS 图片地址。真实调用使用独立的 `VISION_GATEWAY_*` 后端配置；未配置时返回 `model.mode = "local-demo"`，不会发送外部请求。

## 公众号 Agent

> 过渡说明：`/agent-runs` 是当前实现兼容入口。Conversation-first 重构后，新前端应使用 `docs/api/conversations.md` 中的 `/conversations/:conversationId/runs` 和 `/runs/:runId/decisions`。旧接口在迁移完成前保留，不作为新功能扩展主线。

### `POST /agent-runs`

创建 Agent 运行。请求包含工作区、文章、生成目标、素材和排版 skill，不允许传模型密钥。

```json
{
  "workspaceId": "workspace_1",
  "articleId": "article_1",
  "topic": "儿童摄影",
  "audience": "未成年儿童家长",
  "sellingPoints": ["自然抓拍", "成长记录"],
  "assetIds": ["asset_1", "asset_2"],
  "skillPackId": "skill_editorial_1",
  "maxSteps": 12
}
```

响应 `202`：

```json
{
  "runId": "run_1",
  "status": "queued",
  "currentStep": "analyzing_assets",
  "lockVersion": 1
}
```

### `GET /agent-runs/:runId`

返回当前状态、结构化计划、循环次数、当前/最佳版本和是否等待用户。

### `GET /agent-runs/:runId/steps`

返回当前会话或计划条使用的步骤列表。步骤只包含可展示摘要，不返回原始思维链、密钥或未脱敏 prompt。

```json
{
  "items": [
    {
      "stepId": "step_2",
      "stepNo": 2,
      "type": "planning",
      "status": "succeeded",
      "title": "执行计划已生成",
      "summary": "采用成长画册结构，先排版再扩充正文。",
      "result": {
        "tasks": [
          { "id": "layout", "title": "生成图文骨架", "status": "pending" },
          { "id": "expand", "title": "按骨架扩充", "status": "pending" },
          { "id": "review", "title": "整体审阅", "status": "pending" }
        ]
      },
      "createdAt": "2026-07-26T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

### `POST /agent-runs/:runId/decisions`

仅在 `waiting_user` 状态接受决定。请求必须携带当前 `lockVersion` 和 `idempotencyKey`。

```json
{
  "stepId": "step_3",
  "lockVersion": 4,
  "idempotencyKey": "decision-client-uuid",
  "decision": "approve",
  "selectedOptionId": "story_first",
  "instruction": "保留第一组照片，减少营销感"
}
```

版本冲突返回 `409 AGENT_RUN_VERSION_CONFLICT`。

### `POST /agent-runs/:runId/messages`

追加用户指令。运行中收到的非阻塞指令在下一个步骤生效；会改变结构方向的指令使运行进入 `waiting_user`。

### `POST /agent-runs/:runId/continue`

恢复可继续的失败任务或已提交决定的等待任务。接口要求幂等键，不允许绕过确认策略。

### `POST /agent-runs/:runId/cancel`

取消后续步骤。已保存版本和步骤记录保留。

### Agent 事件

第一版使用轮询 `GET /agent-runs/:runId/steps`。后续可增加 SSE，但事件结构保持一致：

```text
run.status_changed
step.started
step.completed
step.failed
decision.required
article.version_created
review.completed
run.completed
```

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `GENERATION_QUOTA_EXCEEDED` | 403 | 配额不足。 |
| `GENERATION_MODEL_UNAVAILABLE` | 503 | 模型配置不可用或供应商失败。 |
| `GENERATION_MODEL_TIMEOUT` | 504 | 模型调用超时。 |
| `GENERATION_OUTPUT_INVALID` | 422 | 模型输出不符合结构契约。 |
| `GENERATION_POLICY_BLOCKED` | 403 | 策略或安全审核阻止生成。 |
| `AGENT_RUN_NOT_FOUND` | 404 | Agent 运行不存在或无权访问。 |
| `AGENT_RUN_INVALID_STATE` | 409 | 当前状态不允许该操作。 |
| `AGENT_RUN_VERSION_CONFLICT` | 409 | lockVersion 已变化，需要刷新。 |
| `AGENT_DECISION_REQUIRED` | 409 | 必须先提交用户决定。 |
| `AGENT_LOOP_LIMIT_REACHED` | 422 | 达到循环上限并暂停。 |
| `AGENT_STEP_OUTPUT_INVALID` | 422 | 步骤输出不符合结构契约。 |
