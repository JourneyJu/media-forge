# 测试用例：文章与版本

## 模块文档

- `docs/modules/articles/README.md`

## 当前状态

## 用例

| ID | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| ART-001 | 创建文章草稿 | 在 Conversation 内创建文章 | 返回带 `conversationId` 的 `draft` 文章摘要。 |
| ART-002 | 保存 AI 版本 | 提交合法 `ArticleDocument` | 写入 `article_versions.content_json` 和 `html_snapshot_key`。 |
| ART-003 | 拒绝非法结构 | 提交缺少 `type=doc` 的内容 | 返回 `ARTICLE_SCHEMA_INVALID`，不创建版本。 |
| ART-004 | 渲染微信 HTML | 对当前版本执行 render | HTML 不包含脚本、事件属性和外部 CSS。 |
| ART-005 | 记录复制事件 | 复制当前版本 HTML | 写入导出事件，文章可转为 `exported`。 |
| ART-006 | 恢复历史版本 | 从 `version_1` 恢复 | 创建新版本，不直接回指历史版本。 |
| ART-007 | 视频 warning | 文章含 `video` 块 | 渲染结果包含 `video_fallback` warning。 |
| ART-008 | Conversation 级删除 | 删除文章所属 Conversation | Article、全部 Version、导出事件和对象快照最终不存在。 |
| ART-009 | 禁止文章独立硬删除 | 尝试调用文章 DELETE | 接口不存在或拒绝，提示通过 Conversation 删除。 |
