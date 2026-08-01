# L 级改动计划：服务端生产部署

## 需求背景和分级

用户要求开始部署 MediaForge 服务端。当前前端已部署到 Cloudflare Workers，服务端仍依赖本地 PostgreSQL、Redis 和 MinIO。生产部署需要把 `apps/auth`、`apps/service`、`apps/worker` 分别托管，并接入线上 PostgreSQL、Redis 和对象存储。

```text
需求分级：L
分级理由：涉及生产运行架构、外部托管服务、数据库迁移、对象存储和队列依赖。
影响范围：apps/auth、apps/service、apps/worker、部署文档、环境变量模板。
是否需要人工确认：是。用户已确认按推荐方案推进。
```

## 推荐方案

- Node 托管：Railway
- PostgreSQL：Neon Postgres
- Redis：Upstash Redis
- 对象存储：Cloudflare R2
- 前端：继续使用 Cloudflare Workers

## 非目标

- 不把 `apps/service`、`apps/auth`、`apps/worker` 改造成 Cloudflare Workers。
- 不迁移 PostgreSQL schema 结构。
- 不把 BullMQ 改造成 Cloudflare Queues。
- 不提交真实连接串、密钥、token 或私钥。
- 不接入真实模型网关，首轮生产连通可先使用 `MODEL_MODE=demo`。

## 影响面

| 领域 | 影响 | 说明 |
| --- | --- | --- |
| auth | 是 | 需要独立 Railway 服务和生产密钥。 |
| service | 是 | 需要连接 Neon、Upstash、R2、auth。 |
| worker | 是 | 需要连接 Neon、Upstash、R2 并消费 BullMQ。 |
| 数据库 | 是 | 需要在线执行 auth/service migration。 |
| 对象存储 | 是 | 从 MinIO 参数切换为 R2 S3 参数。 |
| 前端 | 是 | 后端域名确定后更新 `NEXT_PUBLIC_*` 并重建前端。 |

## allowed_files

```yaml
allowed_files:
  - .plan/20260801-backend-production-deploy.md
  - .env.example
  - docs/runbooks/backend-production-deploy.md
  - apps/service/src/creation-graph/queue.ts
  - apps/service/src/creation-graph/queue.test.ts
verification:
  - pnpm --filter @mediaforge/service test
  - pnpm --filter @mediaforge/auth typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/worker typecheck
```

## 契约与数据变更

无 API contract 或数据库 schema 变更。需要执行现有迁移：

```bash
pnpm --filter @mediaforge/auth db:migrate
pnpm --filter @mediaforge/service db:migrate
```

## 实施步骤

1. 补生产部署 runbook。
2. 补 `.env.example` 的生产变量清单。
3. 修正 Redis `rediss://` TLS 解析，支持 Upstash。
4. 验证后端测试和类型检查。
5. 用户在 Neon、Upstash、Railway 创建资源并配置密钥。
6. 迁移数据库。
7. 部署 auth/service/worker。
8. 回填前端 `NEXT_PUBLIC_AUTH_URL` 和 `NEXT_PUBLIC_SERVICE_URL` 并重新部署前端 Worker。

## 风险与应对

- Upstash Redis 使用 TLS：代码必须识别 `rediss://` 并开启 TLS。
- JWT/密码私钥丢失会导致已签发 token 或加密密码不可用：生产私钥必须保存在 Railway 变量中并备份到安全位置。
- `apps/service` 只负责派发队列，`apps/worker` 负责消费队列：worker 未部署时任务会堆积。
- Neon pooled URL 适合应用运行，迁移建议使用 direct URL，避免连接池对 DDL 的影响。
- R2 S3 凭证必须最小权限，仅允许目标 bucket。

## AI 自审

```text
AI 自审结论：通过
服务边界：仍保持浏览器 -> web -> service -> PG/R2/Redis/模型网关。
契约与数据：不改 contract，不改 schema，只执行既有 migration。
安全风险：不提交密钥；文档只写变量名和占位符。
测试方案：覆盖 Redis URL 解析测试，并运行三端 typecheck。
反方意见：若追求 Cloudflare 原生，可后续迁移 Queues/Hyperdrive；首轮上线优先选择改动最小的托管方案。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-01
备注：用户回复“好的，按照现在的方案开始后端的部署”。
```
