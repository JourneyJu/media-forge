# API：资源与上传暂存

## 模块文档

- `docs/modules/assets/README.md`

## 状态

本文描述目标契约。正式实现前需同步 `packages/contracts/src/assets.ts`。浏览器只访问 Service，不直接持有 MinIO / S3 管理凭据。

## `POST /upload-sessions`

创建当前用户的资源暂存会话。

### 请求

```json
{
  "idempotencyKey": "01J4-upload-session"
}
```

### 响应 `201`

```json
{
  "id": "upload_session_1",
  "status": "active",
  "expiresAt": "2026-07-28T10:00:00.000Z"
}
```

UploadSession 不创建 Conversation，也不进入历史列表。

## `POST /upload-sessions/:uploadSessionId/resources`

上传单个资源。

### Headers

```text
Content-Type: image/jpeg | image/png | image/webp | image/gif
Content-Length: 1..10485760
X-File-Name: encodeURIComponent(originalName)
Idempotency-Key: client-generated-key
```

请求体为原始二进制流。Service 校验文件签名并流式写入对象存储。

### 响应 `201`

```json
{
  "id": "resource_1",
  "uploadSessionId": "upload_session_1",
  "status": "staged",
  "originalName": "photo.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 204800,
  "previewUrl": "/resources/resource_1/preview",
  "createdAt": "2026-07-27T10:00:00.000Z"
}
```

第一阶段单张最大 10 MB，单个 Turn 最多绑定 30 个 Resource，前端上传并发不超过 3。

## `GET /upload-sessions/:uploadSessionId`

读取指定 active UploadSession 和 staged Resources，只用于当前编辑生命周期内的请求重试。创作页重新进入时不得自动调用该接口恢复旧暂存资源。

## `DELETE /upload-sessions/:uploadSessionId/resources/:resourceId`

发送前移除 staged Resource，并异步清理对象。attached Resource 返回 `409 RESOURCE_ALREADY_ATTACHED`。

## `GET /resources/:resourceId/preview`

鉴权读取预览图。响应设置正确 `Content-Type`、`Content-Length` 和私有缓存头。

## `GET /resources/:resourceId/content`

鉴权读取原文件。Service 从 MinIO / S3 流式转发，不暴露 object key 或管理凭据。

## 过期清理

UploadSession 默认 24 小时过期。清理 Worker 删除仍为 staged / failed 的 Resource 对象和记录。`consumed` Session 中的 attached Resource 不受 TTL 影响。

## 对象 key

```text
tenants/{tenantId}/users/{userId}/resources/{resourceId}/original
tenants/{tenantId}/users/{userId}/resources/{resourceId}/preview
```

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `UPLOAD_SESSION_NOT_FOUND` | 404 | 暂存会话不存在或无权限。 |
| `UPLOAD_SESSION_EXPIRED` | 410 | 暂存会话已过期。 |
| `RESOURCE_NOT_FOUND` | 404 | Resource 不存在或无权限。 |
| `RESOURCE_TYPE_UNSUPPORTED` | 422 | 文件类型不支持。 |
| `RESOURCE_SIGNATURE_INVALID` | 422 | 文件签名与声明类型不一致。 |
| `RESOURCE_TOO_LARGE` | 413 | 文件超过大小限制。 |
| `RESOURCE_UPLOAD_FAILED` | 503 | 对象写入失败。 |
| `RESOURCE_ALREADY_ATTACHED` | 409 | 已发送资源不能单独删除。 |
| `RESOURCE_BLOCKED` | 403 | 安全审核阻止使用。 |

## 旧接口兼容

`/workspaces/:workspaceId/assets/*` 在迁移期只做旧数据兼容，不用于新会话主链路。新上传不依赖默认 workspace。
