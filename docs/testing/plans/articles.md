# 测试方案：文章与版本

## 模块文档

- `docs/modules/articles/README.md`

## 当前状态

微信公众号生成第一版实现前，必须覆盖文章创建、版本保存、微信 HTML 快照、复制导出和恢复流程。

## 测试范围

| 范围 | 目标 |
| --- | --- |
| 契约测试 | `ArticleDocument`、块类型、版本摘要和渲染结果结构正确。 |
| Renderer 单测 | 微信 HTML 使用保守标签、内联样式并过滤危险内容。 |
| Service 集成 | 保存版本时同时写入 `content_json` 和 HTML 快照 key。 |
| 复制导出 | 复制事件绑定文章版本并记录 warning。 |
| 恢复版本 | 恢复历史版本必须创建新版本。 |
| Conversation 归属 | Article 必须绑定 Conversation，越权检查沿 Conversation 执行。 |
| 聚合删除 | 删除 Conversation 后 Article、Version、导出事件和对象快照最终清理。 |

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/service typecheck
```

## 手动验证

- 生成一篇包含标题、正文、图片、二维码和 CTA 的文章。
- 复制微信 HTML 到微信公众号后台。
- 检查图片、段落、分隔符、二维码和 CTA 是否可见。
- 确认视频块展示发布前 warning。
