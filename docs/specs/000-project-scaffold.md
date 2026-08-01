# 规格：项目工程骨架

## 目标

为 AI 公众号内容生成与排版平台建立工程基础。该骨架必须支持真实产品开发，不是一次性 demo。

## 假设

1. 产品形态是 Web 应用。
2. 第一批目标用户是培训机构和本地门店。
3. 第一版不直接发布到微信公众号。
4. 本地开发必须通过 Docker 提供 PostgreSQL 和 MinIO。
5. Redis 纳入本地开发，因为 AI 生成、图片识别、导出和记忆总结应异步处理。
6. 前后端共享契约放在独立 package 中。

## 技术栈

| 层级 | 选择 |
| --- | --- |
| 前端 | Next.js / React / TypeScript |
| 后端服务 | TypeScript 服务，目录为 `apps/service` |
| 共享契约 | TypeScript package |
| 数据库 | PostgreSQL |
| 对象存储 | 本地 MinIO，线上 S3 兼容 |
| 缓存和队列 | Redis |
| 编辑器方向 | Tiptap / ProseMirror |
| AI 集成 | Model Gateway |

## 命令

```bash
pnpm install
pnpm infra:up
pnpm dev
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## 项目结构

```text
apps/service          后端服务
apps/web              前端 Web 应用
packages/contracts    共享领域和 API 契约
docs/process          开发流程
docs/specs            功能和工程规格
docs/standards        工程规范
infra/docker          本地 PostgreSQL、MinIO、Redis
```

## 代码风格

包边界必须使用明确的 TypeScript 类型。

```ts
export type WorkspaceStatus = "active" | "archived";

export interface WorkspaceSummary {
  id: string;
  name: string;
  industry: WorkspaceIndustry;
  status: WorkspaceStatus;
  updatedAt: string;
}
```

## 测试策略

1. 契约：TypeScript 类型检查和 schema 测试。
2. 后端服务：service 单测，数据库和对象存储适配器集成测试。
3. 前端：编辑器和工作流页面组件测试。
4. E2E：创建工作区、上传图片、生成、修改、导出。
5. 基础设施：PostgreSQL、MinIO、Redis 健康检查。

## 边界

始终：

- API 或数据形状变化时先更新 contracts。
- 每个实现任务先声明 `allowed_files`。
- 生成文章版本必须同时保存结构化 JSON 和 HTML 快照。
- 上传文件存对象存储，不存 PostgreSQL。

先确认：

- 新增运行时依赖。
- 修改数据库 schema。
- 修改对象存储路径。
- 修改默认模型供应商。
- 跳过验证。

禁止：

- 提交密钥。
- 明文保存模型 API Key。
- 把对象存储作为可编辑文章状态的唯一来源。
- 把 AI 生成 HTML 作为文章唯一事实源。

## 成功标准

1. 仓库有项目级 `AGENTS.md`。
2. 仓库有项目事实入口 `CONTEXT.md`。
3. 仓库有中文开发流程。
4. 仓库有 PostgreSQL、MinIO、Redis 本地 Docker 基础设施。
5. 仓库有前端、后端服务和共享契约包骨架。
6. 仓库有环境变量示例。
7. 工程骨架符合已拆解到架构、模块和测试文档中的存储与流程决策。
