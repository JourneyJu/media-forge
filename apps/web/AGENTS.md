# 前端协作规则

本目录是 MediaForge 前端 Web 应用，负责工作区、素材上传、文章编辑器、AI 对话、预览和复制导出入口。

## 边界

- 前端只调用 `apps/service` 暴露的接口。
- 不直接访问 PostgreSQL、MinIO、Redis 或模型供应商。
- 页面负责组合流程，复杂业务规则沉到 hooks、model 或后端服务。
- 展示字段和请求响应类型优先来自 `packages/contracts`。

## 必须遵守

- 通用开发规范：`../../docs/standards/coding-general.md`
- TypeScript 规范：`../../docs/standards/typescript.md`
- 注释规范：`../../docs/standards/comments.md`
- 前端服务规范：`../../docs/standards/frontend-nextjs.md`
- 测试规范：`../../docs/standards/testing.md`
- 安全规范：`../../docs/standards/security.md`

## 组件与类型

- 页面文件只做路由入口、布局组合和数据装配。
- 可复用组件必须有清晰 props 类型，避免透传大对象。
- 复杂交互优先拆成展示组件、feature hook 和 API client。
- 服务端契约优先来自 `packages/contracts`，需要视图差异时再定义 `ViewModel`。
- 不用 `any` 绕过 AI 返回、上传识别结果或导出结构。

## 设计要求

- 第一版优先桌面端编辑体验。
- 页面文案使用中文。
- 工具型界面保持清晰、稳定、可扫描。
- 文章预览不能假装等于微信后台最终效果；复制导出以微信 HTML renderer 为准。

## 验证

```bash
pnpm --filter @mediaforge/web typecheck
pnpm --filter @mediaforge/web test
```

## 需要人工确认

- 新增用户可见主流程。
- 修改复制导出交互。
- 引入新的 UI 框架或编辑器依赖。
- 绕过后端直连任何基础设施。
