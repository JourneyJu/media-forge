# L 级改动计划：微信公众号生成功能

## 需求背景

用户需要面向普通人的微信公众号内容生成能力。用户在工作区内输入主题、受众、卖点、风格和语气，上传图片、二维码、海报、视频等素材后，由 AI 生成公众号文章，并提供微信兼容 HTML，用户复制到微信公众号后台发布。

该能力基于原型 `C://Users/50653/.qoderworkcn/workspace/mrxiespg6ztv2wb9/outputs/wechat-article-agent-v4.html` 拆解为仓库长期事实。原型呈现三栏工作台：左侧生成参数和素材，中间手机预览和源码，右侧 AI 对话迭代。

## 分级结论

```text
需求分级：L
分级理由：新增公众号生成主链路，涉及 API、共享契约、数据库 schema、对象存储、AI 调用链路、微信 HTML renderer 和前端工作台。
影响面：apps/web、apps/service、packages/contracts、PostgreSQL、MinIO / S3、Redis、Model Gateway、docs。
是否需要人工确认：是
```

## 非目标

- 第一版不直接对接微信公众号发布 API。
- 第一版不接入微信素材库 API。
- 不把 AI 生成 HTML 作为文章唯一事实源。
- 不把对象存储作为可编辑文章状态的唯一来源。
- 第一版视频只作为素材引用和发布前提示，不承诺复制 HTML 后可直接保留视频播放能力。
- 不新增生产依赖，除非后续单独说明替代方案、影响范围并获得确认。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 新增公众号生成工作台、素材上传、预览、复制、AI 对话和版本入口。 |
| 后端服务 | 是 | 新增素材、文章、版本、生成任务、renderer、模型网关 adapter 编排。 |
| 共享契约 | 是 | 扩展文章结构、素材类型、生成请求响应、renderer warning。 |
| 数据库 schema | 是 | 新增或补齐 `articles`、`article_versions`、`assets`、`generation_jobs`、`usage_logs`、`model_configs`。 |
| 对象存储 | 是 | 保存素材原文件、预览图、HTML 快照、prompt 快照、renderer 元数据。 |
| Redis / 队列 | 是 | 生成、识别、导出等异步任务可使用 Redis 保存短期状态。 |
| AI 调用链路 | 是 | 统一经过 `apps/service` 的 Model Gateway adapter。 |
| 权限 / 安全 | 是 | 模型 Key 不进前端，上传安全审核，HTML sanitize，快照脱敏。 |
| 部署 / 环境变量 | 是 | 第一版需要后端模型网关、对象存储、数据库、Redis 相关 env。 |
| 文档 | 是 | 同步 spec、architecture、modules、api、testing 和 ADR。 |

## 方案设计

整体链路：

```text
用户在 apps/web 填写生成信息并上传素材
→ apps/service 创建或读取文章草稿
→ Asset 模块保存素材元数据和对象存储 key
→ AI Generation 模块组装工作区、素材识别、layout skill 和用户指令
→ Model Gateway 返回结构化 ArticleDocument
→ contracts schema 校验
→ WeChat Renderer 输出微信兼容 HTML
→ Article 模块保存 ArticleVersion：content_json + html_snapshot_key + prompt_snapshot_key
→ 前端展示预览、源码、兼容性 warning 和复制入口
```

第一版模型配置采用后端环境变量提供系统默认模型。正式产品形态再由管理与配额模块提供 `model_configs`，API Key 加密保存，只允许后端解密调用。

## 契约与数据变更

### 共享契约

- `packages/contracts/src/articles.ts`：扩展 `ArticleBlockType`，增加 `video`、`button`、`footer` 等微信文章块；补充文章详情、版本详情、渲染结果和 warning 类型。
- `packages/contracts/src/assets.ts`：扩展素材媒体类型、上传完成、视频素材和可访问 URL 信息。
- `packages/contracts/src/ai-generation.ts`：新增公众号文章生成和修订请求响应。
- `packages/contracts/src/admin.ts`：后续新增模型配置响应，不返回密钥明文。

### 数据库

- `articles`：文章主记录，绑定工作区、标题、状态、当前版本。
- `article_versions`：版本号、来源、`content_json`、`html_snapshot_key`、`prompt_snapshot_key`、`renderer_version`、`skill_pack_version`。
- `assets`：素材元数据、对象存储 key、预览 key、识别结果、安全审核状态。
- `generation_jobs`：生成任务状态、输入摘要、错误分类、关联文章和版本。
- `usage_logs`：模型、token、耗时、场景和成本。
- `model_configs`：正式产品模型配置，API Key 加密保存。

### 对象存储

```text
tenants/{tenantId}/workspaces/{workspaceId}/assets/{assetId}/original
tenants/{tenantId}/workspaces/{workspaceId}/assets/{assetId}/preview
tenants/{tenantId}/workspaces/{workspaceId}/articles/{articleId}/versions/{versionId}/wechat.html
tenants/{tenantId}/workspaces/{workspaceId}/articles/{articleId}/versions/{versionId}/prompt.json
tenants/{tenantId}/workspaces/{workspaceId}/articles/{articleId}/versions/{versionId}/render-meta.json
```

## allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/articles.ts
  - packages/contracts/src/assets.ts
  - packages/contracts/src/ai-generation.ts
  - packages/contracts/src/admin.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/*.test.ts
  - apps/service/src/articles/*
  - apps/service/src/assets/*
  - apps/service/src/ai-generation/*
  - apps/service/src/admin/*
  - apps/service/src/adapters/*
  - apps/service/src/renderers/*
  - apps/service/src/http.ts
  - apps/service/src/*.test.ts
  - apps/web/app/*
  - apps/web/app/lib/*
  - apps/web/app/components/*
  - docs/**
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/web typecheck
  - pnpm typecheck
  - pnpm test
```

## 实施步骤

1. 同步文档和人工确认本计划。
2. 扩展共享契约和契约测试。
3. 设计数据库迁移和对象存储路径常量。
4. 实现 Model Gateway adapter、生成任务、文章版本和微信 renderer。
5. 实现素材上传、识别结果保存和资源可达性检查。
6. 实现前端三栏工作台、预览、源码、复制、对话修订和版本入口。
7. 补齐单测、集成测试和关键前端流程验证。
8. 做微信公众号后台手动复制实测并记录兼容性结论。

## 验证方案

- 契约：文章结构、素材、生成请求响应的 schema 和类型检查。
- Renderer：微信 HTML 白名单、内联样式、禁止脚本、图片 URL、长标题、二维码、视频 warning。
- Service：生成成功保存 `content_json` 和 HTML 快照；非法模型输出失败分流；上传完成后元数据落库。
- Web：生成、预览、源码、复制、对话修订、版本恢复的关键路径。
- 手动：复制 HTML 到微信公众号后台，检查文字、图片、二维码、分隔、CTA、warning。

## 迁移与回滚

- 数据迁移先添加新表和新字段，不删除旧字段。
- 生成链路可通过功能开关关闭，仅保留工作区基础功能。
- 如果 renderer 输出出现兼容性问题，回滚 `renderer_version` 到上一个版本，并保留历史快照。
- 模型配置第一版使用 `.env`，数据库模型配置上线前不影响现有环境。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 微信后台清洗 HTML 样式 | 复制后视觉不一致 | 使用保守标签、内联样式、白名单 renderer 和手动实测。 |
| 模型输出非法结构 | 无法保存版本或页面报错 | schema 校验、重试、失败分类，不保存坏版本。 |
| 图片 URL 不可被微信后台访问 | 复制后图片不可见 | 使用 HTTPS 可访问 URL，复制前资源可达性检查。 |
| 视频复制兼容性弱 | 用户误以为可直接发布视频 | 第一版仅支持占位和发布前 warning。 |
| API Key 泄露 | 安全事故 | Key 只在后端 `.env` 或加密表中保存，不返回前端，不写日志。 |
| 成本不可控 | 生成费用失控 | 记录 `usage_logs`，按工作区和场景做配额。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级成立，涉及 schema、API、主链路、对象存储和 AI 编排。
服务边界：保持 apps/web → apps/service → PostgreSQL / MinIO / Redis / Model Gateway。
契约与数据：必须先扩展 contracts、数据库文档和 API 文档，再实现。
异常路径：已覆盖模型失败、解析失败、上传失败、对象存储不可达、微信兼容 warning。
安全风险：重点控制 HTML sanitize、上传审核、模型 Key 加密和 prompt 快照脱敏。
测试方案：包含契约、renderer、service、web、手动微信后台实测。
反方意见：一次性实现全链路风险较高，建议按契约、后端、前端、兼容性验证分阶段交付。
需要人工重点看的问题：视频第一版边界、模型配置产品形态、对象存储线上访问策略、是否需要登录鉴权。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-26
备注：用户明确回复“开始实施”，同意按本计划进入分阶段实现。
```

## Agent 编排扩展（2026-07-26）

### 变更背景

现有同步生成只产生单次文章结果，不能展示 AI 执行计划，也不能稳定完成“先排版、再扩充、再审阅、结构重构后重新扩充”的闭环。用户要求将资源先交给 AI 分析，在右侧对话区展示计划，并允许在关键节点确认。

### 新增影响面

- 共享契约：`AgentRun`、`AgentStep`、`AgentPlan`、`ArticleOutline`、`ReviewReport`、`UserDecision`。
- 数据库：新增 `agent_runs`、`agent_steps`、`agent_decisions` 和迁移。
- 后端：新增 Agent Orchestrator、步骤 policy、队列 Worker、幂等和恢复机制。
- 前端：右侧对话区升级为计划和步骤控制台，支持确认、取消、继续和版本查看。
- AI 链路：视觉分析、策划、排版、扩充、审阅、重构和终审分步调用。
- 测试：状态机、循环上限、用户确认、步骤幂等、版本安全和隐私。

### 新增实施顺序

1. 扩展 contracts，定义 Agent 状态、计划、步骤、审阅报告和决定 schema。
2. 增加数据库迁移及 repository，先完成状态机持久化。
3. 实现确定性 Orchestrator 和 policy，不接模型也能用 fake step runner 验证流程。
4. 依次接入素材分析、计划、排版、扩充、审阅和重构 adapter。
5. 实现 Agent API 和步骤轮询。
6. 将右侧对话区接入计划、步骤事件和用户确认。
7. 补齐集成测试、失败恢复和成本/循环限制。

### Agent 扩展 allowed_files 草案

```yaml
allowed_files:
  - packages/contracts/src/agent-runs.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/*.test.ts
  - apps/service/src/agent-runs/*
  - apps/service/src/adapters/*
  - apps/service/src/http.ts
  - apps/service/src/*.test.ts
  - apps/web/app/page.tsx
  - apps/web/app/components/agent-console/*
  - apps/web/app/lib/agent-runs-api.ts
  - docs/**
  - .plan/20260726-wechat-article-generation.md
verification:
  - pnpm --filter @mediaforge/contracts typecheck
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/web typecheck
  - pnpm test
```

### Agent 扩展人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-07-26
备注：用户明确回复“开始实施”，同意进入 Agent 扩展纵向切片实现。
```
