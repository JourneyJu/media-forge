# 模块：资源与对象存储

## 模块定位

资源模块负责用户上传或粘贴的图片等文件，管理 Conversation 创建前的暂存状态、发送后的消息归属、鉴权读取和会话级删除清理。

## 职责边界

### 负责

- 创建用户级 `UploadSession`。
- 接收资源二进制流并写入 MinIO / S3。
- 保存 Resource 元数据、对象 key、完整性和状态。
- 提供鉴权后的原文件和预览图读取。
- 发送前移除 staged Resource。
- 清理过期 UploadSession 和孤儿对象。
- 为 Conversation 删除任务提供全部对象 key。
- 保存 OCR、类型、质量和安全审核结果。

### 不负责

- 创建 Conversation 或 Message。
- 文章正文生成。
- 发送后单独删除或解绑 Resource。
- 允许浏览器直接使用对象存储管理凭据。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| UploadSession | Conversation 创建前的用户级暂存容器。 |
| Resource | 原图、预览图和元数据的业务记录。 |
| MessageResource | 发送成功后由会话模块维护的不可变消息关系。 |

## 状态

### UploadSession

```text
active → consumed
active → expired
```

### Resource

```text
uploading → staged → attached
uploading → failed
staged → deleting
attached → deleting（仅由 Conversation 删除触发）
```

## 上传流程

```text
POST /upload-sessions
→ POST /upload-sessions/:id/resources
→ Service 校验大小、MIME 和文件签名
→ PostgreSQL 创建 uploading Resource
→ Service 流式写 MinIO
→ PostgreSQL 更新 staged、object keys、etag 和 sha256
→ 返回 ResourceSummary
```

上传完成即持久化，不依赖 Conversation。未发送资源默认 24 小时过期并由 Worker 清理。

## 发送绑定

首次或后续用户 Turn 在同一数据库事务内将 staged Resource 更新为 attached，写入 `conversation_id` 和 `message_resources`。Resource 一旦 attached：

- 只属于一个 Conversation。
- 只能由所属用户通过 Service 读取。
- 不支持独立删除或跨 Conversation 复用。
- 随所属 Conversation 删除。

## 对象路径

```text
tenants/{tenantId}/users/{userId}/resources/{resourceId}/original
tenants/{tenantId}/users/{userId}/resources/{resourceId}/preview
```

对象 key 由 Service 生成。由于上传可能发生在 Conversation 创建前，key 不包含 Conversation ID。

## 安全

- 单文件大小、总数量和允许类型由契约限制。
- 校验 MIME 和文件签名，第一阶段禁止 SVG。
- 文件名只保存为元数据，不参与 object key。
- 读取、移除和绑定均校验 owner。
- bucket 保持私有，浏览器只访问 Service 内容接口。

## API 与测试

- API：`docs/api/assets.md`
- 测试方案：`docs/testing/plans/assets.md`
- 测试用例：`docs/testing/cases/assets.md`
- 生命周期规格：`docs/specs/007-conversation-lifecycle-and-resource-ownership.md`

## 风险

- 对象写入成功、数据库更新失败会产生孤儿对象，由 UploadSession 清理任务处理。
- 微信公众号外部复制需要可访问 HTTPS 图片地址，本模块的鉴权预览地址不等于发布 CDN 地址。
- 旧 `assets` 表只在迁移期兼容读取，不能与新 Resource 长期双写。
