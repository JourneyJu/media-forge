# 模块：文章与版本

## 模块定位

文章与版本模块负责公众号文章草稿、结构化内容、历史版本和可复现快照。

## 职责边界

### 负责

- Conversation 内文章创建、编辑、归档。
- 文章版本保存。
- `content_json` 和 HTML 快照关联。
- 历史版本恢复。
- 微信兼容 HTML 快照和复制导出事件关联。
- 文章当前版本指针维护。

### 不负责

- 图片原文件上传。
- AI 模型调用。
- 微信平台发布。
- 模型供应商配置。

## 领域对象

| 对象 | 说明 |
| --- | --- |
| Article | 一篇公众号文章草稿，属于一个 Conversation。 |
| ArticleVersion | 一次生成、修订、手动保存或恢复形成的正式版本。 |
| ArticleDocument | 可编辑结构化内容，保存在 `article_versions.content_json`。 |
| WeChatHtmlSnapshot | renderer 输出的微信兼容 HTML，不可变快照。 |
| ExportEvent | 用户复制或导出动作记录，用于审计和用量统计。 |

## 文章结构

`ArticleDocument` 是文章事实源，HTML 不是事实源。第一版块类型包括：

| 块类型 | 用途 |
| --- | --- |
| `heading` | 标题或小标题 |
| `paragraph` | 正文段落 |
| `image` | 正文图片 |
| `video` | 视频素材占位和发布前提示 |
| `quote` | 引用或金句 |
| `divider` | 分隔符 |
| `callout` | 强调信息 |
| `signup` | 报名或转化模块 |
| `address` | 门店地址 |
| `qrcode` | 二维码 |
| `button` | CTA 按钮样式文本 |
| `footer` | 结尾和署名 |

## 状态和流程

### 状态

| 状态 | 说明 |
| --- | --- |
| `draft` | 草稿，可继续生成和修改。 |
| `exported` | 至少发生过一次复制或导出。 |
| `archived` | 已归档，不进入默认列表。 |

### 版本保存流程

```text
接收 ArticleDocument
→ 校验结构
→ 调用 WeChat Renderer
→ 保存 HTML 快照到 MinIO / S3
→ 写入 article_versions
→ 更新 articles.current_version_id
```

### 恢复流程

```text
选择历史版本
→ 复制历史 content_json
→ 以 source=restore 创建新版本
→ 重新渲染当前 renderer 或复用历史 HTML 快照
→ 更新 current_version_id
```

## 数据归属

| 数据 | 归属 | 说明 |
| --- | --- | --- |
| articles | PostgreSQL | 文章主记录 |
| article_versions.content_json | PostgreSQL | 可编辑结构化内容 |
| HTML / Markdown / prompt 快照 | MinIO / S3 | 不可变快照 |
| 复制导出事件 | PostgreSQL | 记录文章版本、导出类型、时间和兼容性 warning |

## 会话删除边界

- Article 必须保存 `conversation_id`。
- Article、ArticleVersion、导出事件和对象快照随所属 Conversation 删除。
- 文章和版本不提供绕过 Conversation 聚合的独立硬删除。
- 删除所需 HTML、prompt 和渲染快照 key 必须进入 Conversation deletion outbox。

## API 路由

- `docs/api/articles.md`

## 测试路由

- `docs/testing/plans/articles.md`
- `docs/testing/cases/articles.md`

## 风险

- 微信后台会清洗 HTML，预览不能承诺等于最终发布效果。
- 保存版本时必须同时写入 `content_json` 和 HTML 快照 key，避免历史不可复现。
- 视频块复制兼容性弱，第一版只能作为发布前提示和占位。
- 文章与 Conversation 关系缺失会导致会话删除不完整，数据库必须使用外键约束。
