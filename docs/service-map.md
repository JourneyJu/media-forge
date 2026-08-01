# 服务地图

## 主链路

```text
浏览器
→ apps/web
→ apps/service
→ PostgreSQL / MinIO / Redis
→ apps/worker
→ PostgreSQL / Redis / Model Gateway
```

## 服务清单

| 模块 | 端口 | 职责 | 本地启动 | 验证 |
| --- | --- | --- | --- | --- |
| `apps/web` | 3000 | 前端 Web 应用，承载历史会话、编辑器、AI 对话、资源和导出入口 | `pnpm --filter @mediaforge/web dev` | `pnpm --filter @mediaforge/web typecheck` |
| `apps/service` | 4000 | 后端服务，承载会话、品牌上下文、资源、文章版本、AI 编排入口、配额和用量 | `pnpm --filter @mediaforge/service dev` | `pnpm --filter @mediaforge/service typecheck` |
| `apps/worker` | - | BullMQ 消费、LangGraph 多 Agent 执行、事件和 Artifact 写入 | `pnpm dev:worker` | `pnpm --filter @mediaforge/worker typecheck` |
| `packages/contracts` | - | 前后端共享契约和领域类型 | - | `pnpm --filter @mediaforge/contracts typecheck` |
| PostgreSQL | 5432 | 业务事实数据源 | `pnpm infra:up` | Docker healthcheck |
| MinIO | 9000 / 9001 | S3 兼容对象存储 | `pnpm infra:up` | bucket `mediaforge-local` 存在 |
| Redis | 6379 | 缓存、队列、限流、短期状态 | `pnpm infra:up` | Docker healthcheck |

## 边界

- `apps/web` 只能调用 `apps/service`。
- `apps/service` 负责业务 API、PostgreSQL、MinIO、Redis 入队和 SSE。
- `apps/worker` 负责从 PostgreSQL 加载上下文、消费 Redis 队列并调用模型网关。
- `packages/contracts` 不依赖前端或后端实现。
- 对象存储不作为可编辑文章状态的唯一事实源。
- 未发送空会话只存在于 `apps/web`，不得进入 PostgreSQL。
- 用户可见创作空间统一由 Conversation 表达；品牌上下文不参与历史列表。
