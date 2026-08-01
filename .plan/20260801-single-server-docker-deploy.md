# L 级改动计划：单台服务器 Docker 部署

## 需求背景

用户明确放弃之前的 Cloudflare、Railway、Supabase 等托管拆分部署方式，改为使用一台自有服务器，通过 Docker 部署 MediaForge 的 Web、Auth、Service、Worker、PostgreSQL、Redis 和对象存储。随后用户指定服务器地址 `146.56.198.214`，要求使用 Nginx 统一代理，先只开放 80 端口，并做一套本地 CI/CD 发布脚本。

这属于 L 级改动，因为部署边界、运行时拓扑、外部依赖落点、生产环境变量和安全暴露面都发生变化。

## 分级结论

```text
需求分级：L
分级理由：从多平台托管改为单服务器 Docker Compose，影响服务边界、部署拓扑、数据库、Redis、对象存储、HTTPS、环境变量和运维方式。
影响面：部署配置、运行文档、生产环境变量、反向代理、持久化数据卷。
是否需要人工确认：是，用户已明确确认改用服务器部署。
```

## 非目标

- 不继续推进 Cloudflare Workers / Pages 的正式部署。
- 不继续推进 Railway、Neon、Supabase、PlanetScale、R2 等托管组合方案。
- 不在本次启用 HTTPS，先按用户要求使用 80 端口。
- 不修改业务 API 契约、数据库 schema 或前后端功能行为。
- 不把真实密钥、token、密码或服务器 IP 写入仓库。
- 不在本次接入真实模型供应商，默认保留 `MODEL_MODE=demo`。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 生产构建时把 Auth 和 Service 指向同源域名。 |
| 后端服务 | 是 | Service、Auth、Worker 改为容器运行。 |
| 共享契约 | 否 | 不变更 contracts。 |
| 数据库 schema | 否 | 仅变更部署方式，不改 schema。 |
| 对象存储 | 是 | 使用同机 MinIO，S3 兼容接口。 |
| Redis / 队列 | 是 | 使用同机 Redis，Worker 消费队列。 |
| AI 调用链路 | 否 | 默认 demo 模式，不接真实模型。 |
| 权限 / 安全 | 是 | Nginx 统一 80 端口入口，数据库/Redis/MinIO 不暴露公网。 |
| 部署 / 环境变量 | 是 | 新增生产 compose、Nginx 配置、生产 env 示例。 |
| 文档 | 是 | 新增单服务器部署 runbook。 |

## 方案设计

采用单台服务器上的 Docker Compose：

- `nginx` 作为公网入口，负责 80 端口和路径反向代理。
- `web` 运行 Next.js 前端。
- `auth` 运行认证服务。
- `service` 运行业务 API 和创作调度入口。
- `worker` 消费 Redis 队列并执行后台任务。
- `postgres` 保存业务事实数据。
- `redis` 保存缓存、锁、限流和队列短期状态。
- `minio` 提供 S3 兼容对象存储。

公网只开放 80、22。PostgreSQL、Redis、MinIO 仅在 Docker 网络内访问。

## 契约与数据变更

无 contracts 变更，无数据库 schema 变更，无数据迁移。

生产数据通过 Docker volume 持久化：

- `postgres-data`
- `redis-data`
- `minio-data`

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260801-single-server-docker-deploy.md
  - .dockerignore
  - .gitignore
  - Dockerfile
  - apps/auth/package.json
  - apps/service/package.json
  - apps/worker/package.json
  - packages/contracts/package.json
  - infra/docker/docker-compose.prod.yml
  - infra/docker/nginx.conf
  - infra/docker/.env.prod.example
  - scripts/deploy-prod.sh
  - docs/runbooks/single-server-docker-deploy.md
verification:
  - docker compose --env-file infra/docker/.env.prod.example -f infra/docker/docker-compose.prod.yml config
  - pnpm --filter @mediaforge/auth typecheck
  - pnpm --filter @mediaforge/service typecheck
  - pnpm --filter @mediaforge/worker typecheck
  - pnpm --filter @mediaforge/web typecheck
```

## 实施步骤

1. 新增生产 Dockerfile 和 Compose 文件。
2. 新增 Nginx 同源反向代理配置。
3. 新增生产环境变量示例，并确保真实 `.env.prod` 被忽略。
4. 新增单服务器部署 runbook 和本地发布脚本。
5. 校验 compose 配置和 TypeScript 类型。
6. 登录服务器安装 Docker，生成 `.env.prod`，启动生产栈。
7. 提交并推送到 GitHub。

## 验证方案

- 使用 `docker compose config` 校验生产 compose 语法和环境变量展开。
- 使用各包 `typecheck` 校验代码在现有部署配置下仍通过类型检查。
- 服务器上线后用 `curl /auth/password-key`、`curl /health` 和浏览器登录验证。

## 迁移与回滚

当前无已有生产数据迁移。

回滚代码：

```bash
git checkout <previous-commit>
docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml up -d --build
```

数据回滚需要依赖 PostgreSQL 备份和服务器磁盘快照。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 单机故障 | 全站不可用 | 前期接受；上线后补服务器快照和数据库备份。 |
| 磁盘占满 | 上传、数据库写入失败 | 定期监控磁盘，MinIO 和 Postgres 做备份/清理策略。 |
| 密钥泄露 | 账号和数据风险 | `.env.prod` 不入库，只在服务器保存。 |
| 仅 HTTP | Cookie 和传输安全弱于 HTTPS | 前期按用户要求先用 80，后续绑定域名后切 HTTPS。 |
| Docker 构建较慢 | 发布耗时 | 前期可接受；后续可拆分镜像和 CI 构建。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：L 级成立，部署拓扑和生产依赖落点发生变化。
服务边界：浏览器仍只访问 Nginx 公网入口；数据库、Redis、MinIO 不直接暴露。
契约与数据：不修改 API 契约和 schema。
异常路径：已记录 HTTPS、磁盘、单机故障和回滚路径。
安全风险：真实密钥不入库；公网入口由 Nginx 统一控制；当前仅 HTTP，建议后续换 HTTPS。
测试方案：先做 compose config 和 typecheck；服务器上线后补真实访问验证。
反方意见：单机方案可用性低于托管拆分方案，但更适合前期低成本、低用户量场景。
需要人工重点看的问题：服务器规格、域名 DNS、备份频率、是否需要公网 MinIO 控制台。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-01
备注：用户明确表示“放弃之前的部署方式，我现在改用服务器部署”，并指定使用 Nginx 统一代理、先使用 80 端口。
```
