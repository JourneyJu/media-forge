# API：文章与版本

## 模块文档

- `docs/modules/articles/README.md`

## 接口列表

新增或修改接口时，先同步 `packages/contracts/src/articles.ts`。

## 权限

所有文章接口必须沿 `conversation_id` 校验用户对所属 Conversation 的权限。归档文章默认不出现在列表，但可通过详情或版本接口访问。

## `POST /conversations/:conversationId/articles`

创建公众号文章草稿。

### 请求

```json
{
  "title": "春季招生公开课",
  "scenario": "enrollment"
}
```

### 响应 `201`

```json
{
  "id": "article_1",
  "conversationId": "conversation_1",
  "title": "春季招生公开课",
  "status": "draft",
  "updatedAt": "2026-07-26T00:00:00.000Z"
}
```

## `GET /articles/:articleId`

返回文章主记录和当前版本摘要。

## `GET /articles/:articleId/versions`

返回版本列表，按 `versionNo` 倒序。

## `GET /articles/:articleId/versions/:versionId`

返回版本详情，包括 `contentJson`、`wechatHtmlUrl`、`rendererVersion`、`skillPackVersion` 和兼容性 warning。接口不得直接返回 prompt 中的密钥或敏感配置。

## `POST /articles/:articleId/versions`

手动保存新版本。用于编辑器修改后保存。

### 请求

```json
{
  "source": "manual",
  "contentJson": {
    "type": "doc",
    "attrs": {
      "title": "春季招生公开课",
      "scenario": "enrollment"
    },
    "content": []
  },
  "baseVersionId": "version_1"
}
```

### 响应 `201`

返回新版本摘要和当前微信 HTML 快照 key。

## `POST /articles/:articleId/restore`

从历史版本恢复，恢复操作必须创建新版本，不能直接把 `current_version_id` 指回历史版本。

## `POST /articles/:articleId/render/wechat-html`

对当前版本重新渲染微信兼容正文 HTML fragment。用于 renderer 修复或复制前检查。响应包含 `wechatHtml`、`rendererVersion` 和 `warnings`。

`wechatHtml` 不得包含 `html`、`head`、`body`、外部样式表或脚本。该接口不返回剪贴板载荷，也不负责执行复制；web 使用返回的 fragment 和当前 `ArticleDocument`，在用户点击后分别构造 `text/html` 与 `text/plain`。

第一阶段沿用此接口，不新增专用 clipboard API。图片只允许引用素材链路已有的 HTTPS 可访问 URL；图片 URL 不合规时通过现有 `warnings` 返回，不在该接口内代理或转存图片。

## `POST /articles/:articleId/export-events`

记录复制或导出事件。

### 请求

```json
{
  "versionId": "version_2",
  "type": "copy_wechat_html",
  "warnings": ["video_fallback"]
}
```

导出事件必须在剪贴板写入成功后提交。富文本复制使用 `copy_wechat_html`；纯文本降级需要使用契约中独立的导出类型，具体字段在实现前先更新 `packages/contracts/src/articles.ts`。剪贴板权限被拒绝、renderer 失败或复制调用失败时不得记录成功事件。

## 删除

文章和版本不提供独立硬删除接口。删除由 `DELETE /conversations/:conversationId` 统一触发，覆盖 PostgreSQL 记录和 MinIO / S3 快照。

## 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `ARTICLE_NOT_FOUND` | 404 | 文章不存在或无权限。 |
| `ARTICLE_VERSION_NOT_FOUND` | 404 | 版本不存在或不属于该文章。 |
| `ARTICLE_SCHEMA_INVALID` | 422 | `contentJson` 不符合契约。 |
| `RENDER_FAILED` | 500 | 微信 HTML 渲染失败。 |
| `SNAPSHOT_WRITE_FAILED` | 500 | HTML 快照写入对象存储失败。 |
