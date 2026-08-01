# 本地开发

## 启动基础设施

本地 PostgreSQL、MinIO 和 Redis 都由 Docker Compose 管理。

```bash
pnpm infra:up
```

等价命令：

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

如果命令提示无法连接 Docker daemon，请先启动 Docker Desktop。

## 初始化数据库

基础设施首次启动后，以及拉取到新的 `apps/service/migrations/*.sql` 时，执行：

```bash
pnpm db:migrate
```

迁移执行记录保存在 PostgreSQL 的 `schema_migrations` 表中。同一迁移只执行一次；应用服务和 Worker 不在启动时隐式修改数据库结构。

## 服务地址

| 服务 | 地址 |
| --- | --- |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |

MinIO 默认配置：

```text
用户名：minioadmin
密码：minioadmin
bucket：mediaforge-local
```

## Redis

Redis 已在 `infra/docker/docker-compose.yml` 中配置：

```text
container：mediaforge-redis
image：redis:7-alpine
port：6379
data：infra/docker/.data/redis
```

Redis 不需要安装到 Windows 主机。首次执行 `pnpm infra:up` 时，Docker 会拉取 `redis:7-alpine` 并创建 `mediaforge-redis` 容器。仅在 Compose 文件中存在配置，不代表 Redis 已经启动。

应用使用：

```text
REDIS_URL=redis://localhost:6379
```

检查 Redis 容器：

```bash
docker compose -f infra/docker/docker-compose.yml ps redis
```

检查 Redis 是否可用：

```bash
docker exec mediaforge-redis redis-cli ping
```

期望输出：

```text
PONG
```

只有返回 `PONG` 才能启动并验证 BullMQ Worker。Redis 不可用时，多 Agent Run 不得静默退回旧同步生成链路。

查看 Redis 日志：

```bash
docker logs mediaforge-redis
```

Redis 在本项目中只用于缓存、限流、锁、BullMQ 队列和短期任务状态，不保存不可丢失的业务事实。

## 环境变量

复制示例文件：

```bash
cp .env.example .env
cp apps/service/.env.example apps/service/.env
cp apps/web/.env.example apps/web/.env
```

公众号文章生成默认使用本地演示生成器。要启用真实模型，在后端进程环境中同时配置：

```text
MODEL_GATEWAY_PROVIDER=openai-compatible
MODEL_GATEWAY_BASE_URL=https://your-gateway.example.com/v1
MODEL_GATEWAY_API_KEY=仅保存在后端环境中的密钥
MODEL_GATEWAY_DEFAULT_MODEL=模型名称
MODEL_GATEWAY_TIMEOUT_MS=60000
```

`MODEL_GATEWAY_BASE_URL` 需要兼容 `POST /chat/completions`。核心配置不完整时，服务不会发送外部请求，并以 `local-demo` 模式返回。

视觉网关配置：

```text
VISION_GATEWAY_PROVIDER=volcengine-ark
VISION_GATEWAY_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VISION_GATEWAY_API_KEY=仅保存在后端环境中的密钥
VISION_GATEWAY_MODEL=支持视觉输入的推理接入点 ID
VISION_GATEWAY_TIMEOUT_MS=60000
```

## 启动应用

```bash
pnpm dev
```

单独启动：

```bash
pnpm dev:service
pnpm dev:web
```

启动多 Agent Worker：

```bash
pnpm dev:worker
```

完整本地多 Agent 运行需要三个进程：

```text
apps/web
apps/service
apps/worker（独立 BullMQ Worker 运行单元）
```

`pnpm dev:worker` 启动独立 `@mediaforge/worker` 工作区。生产模式默认使用 Model Gateway；本地演示需要显式设置 `MODEL_MODE=demo`。

## 停止基础设施

```bash
pnpm infra:down
```

## 常见问题

如果 Docker 无法连接：

1. 启动 Docker Desktop。
2. 等待左下角状态变为 Running。
3. 重新执行 `pnpm infra:up`。

如果 Redis 未启动：

```bash
docker compose -f infra/docker/docker-compose.yml up -d redis
docker exec mediaforge-redis redis-cli ping
```

如果 Redis 已返回 `PONG` 但 Run 一直为 `queued`：

1. 检查 `pnpm dev:worker` 是否运行。
2. 检查 Worker 日志是否成功连接 `creation-run` 队列。
3. 检查 API 是否实际创建 BullMQ Job。
4. 当前生产化补全前，Conversation API 仍可能走旧同步链路；以 `docs/specs/006-langgraph-multi-agent-production-completion.md` 的实现状态为准。

如果 MinIO bucket 没创建成功：

```bash
docker logs mediaforge-minio-init
```
