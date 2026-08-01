# L 级改动计划：图片素材持久化与紧凑预览

> 状态：已被 `.plan/20260727-conversation-lifecycle-resource-ownership.md` 替代。原方案在发送时才上传，无法满足“上传后立即保存”、无 Conversation 时的资源归属和会话级删除要求，不再单独实施。

## 需求背景

当前前端将用户选择的图片读取为 Data URL，只保存在 React 内存中。后端 Conversation Resource 只记录浏览器生成的临时 ID，没有 `assets` 业务记录，也没有向 MinIO 写入图片，因此页面刷新和历史会话恢复后无法查看原图。

同时，素材区把全部图片横向平铺，图片数量增加后会挤占对话区域。本次改动要将图片缩略图改成最多展示 4 张，后续显示 `+N`，并让已用于对话的图片可持久恢复。

## 分级结论

```text
需求分级：L
分级理由：新增图片上传 API、PostgreSQL assets schema、MinIO 对象写入和生产依赖。
影响面：packages/contracts、apps/service、apps/web、PostgreSQL、MinIO、文档和测试。
是否需要人工确认：是
```

## 非目标

- 本次不实现完整素材库管理页面。
- 本次不生成独立压缩预览图，缩略图先复用原图内容接口并由浏览器缩放。
- 本次不接入 OCR、二维码识别、图片安全审核和自动删除。
- 本次不支持视频、PDF 或任意文件上传，只支持 JPEG、PNG、WebP 和 GIF。
- 本次不把 MinIO bucket 改为公开，也不让浏览器持有对象存储凭据。
- 本次不解决复制 HTML 后图片在外部微信公众号后台的公网访问问题。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 上传状态、紧凑缩略图、`+N`、历史恢复 |
| 后端服务 | 是 | 二进制上传、素材查询、对象内容流 |
| 共享契约 | 是 | Asset、上传响应和错误码 |
| 数据库 schema | 是 | 新增 `assets` 表和会话资源唯一索引 |
| 对象存储 | 是 | 原图写入 MinIO / S3 |
| Redis / 队列 | 否 | 第一版同步完成对象写入后返回 |
| AI 调用链路 | 间接影响 | Worker 获取真实 asset ID，不改变 Graph |
| 权限 / 安全 | 是 | 校验类型、大小、工作区归属和对象 key |
| 部署 / 环境变量 | 是 | 使用现有 S3 环境变量 |
| 文档 | 是 | API、数据库、模块、测试和 runbook |

## 方案设计

### 交互

- 用户选择图片后立即显示本地预览，不在选择阶段产生服务器孤儿对象。
- 图片缩略图从当前尺寸缩小为 `44 × 44`。
- 素材区最多显示前 4 张；超过 4 张时显示一个同尺寸的 `+N` 按钮。
- 点击 `+N` 打开紧凑素材查看层，可查看和移除本次待发送图片。
- 点击发送后，先上传尚未持久化的图片，再创建 Conversation Message、绑定 Conversation Resource、创建 Run。
- 任一图片上传失败时不创建 Run，保留本地预览和失败状态供重试。
- 页面刷新后，从 Conversation Resource 查询 Asset 元数据，使用 Service 内容地址恢复缩略图和手机预览。

### 上传链路

```text
浏览器选择图片
→ 本地 Object URL 预览
→ POST /workspaces/:workspaceId/assets（单文件原始二进制）
→ apps/service 校验请求头、类型和 Content-Length
→ PostgreSQL 创建 uploading Asset
→ Service 流式 PutObject 到 MinIO
→ PostgreSQL 更新 ready、etag 和 object_key
→ 返回 AssetSummary
→ POST /conversations/:id/resources 绑定真实 assetId
```

不采用浏览器直传预签名 URL，因为项目服务边界要求浏览器只访问 `apps/service`。上传并发限制为 3，单张最大 10 MB，单次发送最多 30 张。

### 历史读取

```text
GET /conversations/:id
→ conversation_resources 返回 assetId
→ GET /assets?ids=id1,id2...
→ 返回元数据和 /assets/:id/content 地址
→ 前端恢复缩略图和文章预览
```

`GET /assets/:id/content` 由 Service 从 MinIO 读取并转发，设置正确的 `Content-Type`、缓存头和内容长度，不暴露 bucket 凭据。

## 契约与数据变更

### `AssetSummary`

新增或明确字段：

```text
id
workspaceId
originalName
contentType
sizeBytes
status: uploading | ready | failed
contentUrl
usageType
createdAt
```

### API

```text
POST /workspaces/:workspaceId/assets
Content-Type: image/jpeg | image/png | image/webp | image/gif
Content-Length: 1..10485760
X-File-Name: encodeURIComponent(originalName)

GET /assets?ids=:commaSeparatedIds
GET /assets/:assetId/content
```

错误码：

```text
ASSET_TYPE_UNSUPPORTED
ASSET_TOO_LARGE
ASSET_UPLOAD_FAILED
ASSET_NOT_FOUND
ASSET_NOT_READY
```

### PostgreSQL

新增 `assets`：

```text
id text primary key
workspace_id text not null
original_name text not null
content_type text not null
size_bytes bigint not null
object_key text not null unique
etag text
status text not null
usage_type text not null
created_at timestamptz not null
updated_at timestamptz not null
```

新增唯一索引：

```text
conversation_resources(conversation_id, asset_id)
```

对象 key：

```text
workspaces/{workspaceId}/assets/{assetId}/original
```

所有 ID 只能作为路径段使用并经过服务端校验，禁止用户提供 object key。

## 依赖选型

新增 `@aws-sdk/client-s3` 到 `apps/service`：

- 原因：MinIO 提供 S3 兼容接口，AWS SDK 支持流式 PutObject/GetObject，并便于未来切换正式 S3。
- 替代方案 1：`minio` SDK，API 更直接，但绑定 MinIO，实现迁移性较弱。
- 替代方案 2：手写 AWS Signature V4，不引入依赖但安全和维护风险不可接受。
- 不新增 multipart 解析依赖，上传请求体直接作为单文件二进制流。

## allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/assets.ts
  - packages/contracts/src/assets.test.ts
  - apps/service/package.json
  - apps/service/migrations/002_assets.sql
  - apps/service/src/assets/*
  - apps/service/src/http.ts
  - apps/service/src/conversations/conversation-store.ts
  - apps/service/src/creation-graph/persistence.ts
  - apps/web/app/lib/assets-api.ts
  - apps/web/app/page.tsx
  - apps/web/app/globals.css
  - apps/web/app/lib/wechat-preview.ts
  - apps/web/app/lib/wechat-preview.test.ts
  - docs/api/assets.md
  - docs/modules/assets/README.md
  - docs/architecture/database.md
  - docs/testing/plans/assets.md
  - docs/testing/cases/assets.md
  - docs/runbooks/local-dev.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/web test
  - pnpm typecheck
  - pnpm test
  - pnpm build
```

## 实施步骤

1. 更新 Asset 共享契约、API 文档、数据库设计和测试用例。
2. 新增幂等数据库迁移，创建 `assets` 和会话资源唯一索引。
3. 增加 S3 Client 封装、Asset Repository 和上传 Service。
4. 实现上传、批量元数据查询和内容流读取 API。
5. 前端将 LocalAsset 区分为 local、uploading、ready、failed。
6. 发送时并发上传未持久化图片，完成后绑定真实 asset ID。
7. 将缩略图改为最多 4 张和 `+N` 查看层。
8. 页面刷新时按 Conversation Resource 恢复 Asset 元数据和预览。
9. 完成单测、MinIO 集成测试和 Playwright 浏览器验证。

## 验证方案

- 契约测试：类型、大小、状态和 URL。
- 单元测试：对象 key 生成、类型白名单、大小限制和失败状态。
- 集成测试：上传图片后 MinIO 对象存在，PostgreSQL Asset 为 ready。
- API 测试：批量查询只能返回指定工作区可见素材。
- 异常测试：MinIO 不可用、流中断、重复绑定和非图片上传。
- 前端测试：1、4、5、10 张图片下的缩略图布局和 `+N` 数量。
- 恢复测试：发送后刷新页面，图片缩略图和手机预览仍存在。
- 回归测试：无图片生成、公众号预览、SSE 和追问恢复不受影响。

## 迁移与回滚

- 迁移只新增 `assets` 表和唯一索引，不删除旧数据。
- 历史临时 asset ID 无法补出原图，恢复时跳过并显示“历史素材不可用”，不阻断文章查看。
- 回滚代码后保留 `assets` 表和对象，不删除用户数据。
- 上传失败记录标记 `failed`；对象写入失败时尝试删除残留对象。
- 后续通过清理任务处理长期 `uploading` / `failed` 记录，本次不自动清理。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 大量图片占用 Service 内存 | 服务不稳定 | 请求体流式写 S3，限制单张 10 MB、并发 3 |
| 数据库成功但对象失败 | 历史图片不可用 | 状态机 `uploading → ready/failed` |
| 对象成功但绑定失败 | 产生未引用 Asset | Asset 保留在工作区，后续可重试绑定 |
| 重复发送重复绑定 | 重复素材 | 数据库唯一索引和 `on conflict do nothing` |
| 恶意文件伪装图片 | 内容风险 | MIME 白名单、文件签名字节校验、禁止 SVG |
| 工作区越权读取 | 数据泄漏 | 所有元数据和内容读取校验 workspace 归属 |
| 本地 MinIO URL 不能用于公众号公网 | 导出图片丢失 | 本次明确不承诺公网发布，后续接 CDN / 发布资源代理 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级，包含 schema、上传、对象存储和新生产依赖。
服务边界：浏览器只访问 apps/service，不接触 MinIO 凭据。
契约与数据：PostgreSQL 保存素材事实，MinIO 保存原图，Conversation Resource 只做关联。
异常路径：覆盖上传中断、对象失败、绑定失败、重复绑定和历史临时 ID。
安全风险：限制 MIME、大小和文件签名；object key 服务端生成；禁止 SVG。
测试方案：覆盖 contract、unit、PostgreSQL/MinIO integration、恢复和浏览器布局。
反方意见：使用 Data URL 存数据库实现更快，但会造成数据库膨胀、响应过大且无法流式读取，不采用。
需要人工重点看的问题：确认新增 @aws-sdk/client-s3；确认发送时上传而不是选择后立即上传。
```

## 人工确认

```text
审核结论：待确认
确认人：
确认时间：
备注：确认后按本计划实施。
```
