# 服务端生产部署

本文记录 MediaForge 服务端首轮生产部署方案。

## 部署拓扑

```text
Cloudflare Worker 前端
  -> Railway mediaforge-auth
  -> Railway mediaforge-service
  -> Railway mediaforge-worker

Railway 服务依赖：
  -> Neon Postgres
  -> Upstash Redis
  -> Cloudflare R2
```

首轮目标是跑通登录、API、队列任务和对象存储。真实模型网关可在链路稳定后再接入。

## 外部资源

### Neon Postgres

创建一个生产数据库，保留两个连接串：

```text
DATABASE_URL=pooled connection string
DATABASE_DIRECT_URL=direct connection string
```

应用运行使用 `DATABASE_URL`。执行迁移时优先临时使用 `DATABASE_DIRECT_URL`。

### Upstash Redis

使用 TLS 连接串：

```text
REDIS_URL=rediss://default:<password>@<host>:6379
```

代码已支持 `rediss://` 自动开启 BullMQ TLS。

### Cloudflare R2

创建 bucket：

```text
mediaforge-prod
```

创建 R2 API token 后配置：

```text
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=mediaforge-prod
S3_ACCESS_KEY=<r2_access_key_id>
S3_SECRET_KEY=<r2_secret_access_key>
S3_FORCE_PATH_STYLE=true
```

## Railway 服务

在同一个 GitHub 仓库中创建 3 个 Railway service。

### mediaforge-auth

```text
Build command: pnpm --filter @mediaforge/auth build
Start command: pnpm --filter @mediaforge/auth start
```

环境变量：

```text
NODE_ENV=production
PORT=4100
DATABASE_URL=<neon_pooled_url>
WEB_ORIGIN=https://media-forge.journey-ju-no1.workers.dev
AUTH_JWT_ISSUER=https://<auth-domain>
AUTH_JWT_AUDIENCE=mediaforge-service
AUTH_JWT_PRIVATE_KEY_PEM=<rsa_private_key_pem_with_\n_escaped>
AUTH_PASSWORD_PRIVATE_KEY_PEM=<rsa_private_key_pem_with_\n_escaped>
AUTH_BOOTSTRAP_ADMIN_ACCOUNT=admin
AUTH_BOOTSTRAP_ADMIN_PASSWORD=<strong_initial_password>
```

### mediaforge-service

```text
Build command: pnpm --filter @mediaforge/service build
Start command: pnpm --filter @mediaforge/service start
```

环境变量：

```text
NODE_ENV=production
PORT=4000
DATABASE_URL=<neon_pooled_url>
REDIS_URL=<upstash_rediss_url>
WEB_ORIGIN=https://media-forge.journey-ju-no1.workers.dev
AUTH_JWKS_URL=https://<auth-domain>/auth/jwks.json
AUTH_JWT_ISSUER=https://<auth-domain>
AUTH_JWT_AUDIENCE=mediaforge-service
AUTH_SESSION_VALIDATE_URL=https://<auth-domain>/auth/session/validate
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=mediaforge-prod
S3_ACCESS_KEY=<r2_access_key_id>
S3_SECRET_KEY=<r2_secret_access_key>
S3_FORCE_PATH_STYLE=true
MODEL_MODE=demo
MODEL_CONFIG_ENCRYPTION_KEY=<32_byte_base64_secret>
```

### mediaforge-worker

```text
Build command: pnpm --filter @mediaforge/worker build
Start command: pnpm --filter @mediaforge/worker start
```

环境变量：

```text
NODE_ENV=production
DATABASE_URL=<neon_pooled_url>
REDIS_URL=<upstash_rediss_url>
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=mediaforge-prod
S3_ACCESS_KEY=<r2_access_key_id>
S3_SECRET_KEY=<r2_secret_access_key>
S3_FORCE_PATH_STYLE=true
MODEL_MODE=demo
MODEL_CONFIG_ENCRYPTION_KEY=<same_32_byte_base64_secret_as_service>
CREATION_RUN_WORKER_CONCURRENCY=2
```

## 生成生产私钥

在本机或安全环境生成两把 RSA 私钥：

```bash
openssl genrsa -out auth-jwt-private.pem 2048
openssl genrsa -out auth-password-private.pem 2048
openssl rand -base64 32
```

粘贴到 Railway 环境变量时，RSA 私钥需要把换行转义成 `\n`。`openssl rand -base64 32` 的输出填入 `MODEL_CONFIG_ENCRYPTION_KEY`，用于加密控制台保存的模型供应商 API Key，不是 DeepSeek 或 OpenAI API Key。该值必须长期固定；如果更换，数据库中已保存的模型连接密钥将无法解密。不要提交这些文件。

## 数据库迁移

在 Railway 临时命令、Shell，或本机安全环境中执行：

```bash
DATABASE_URL="<neon_direct_url>" pnpm --filter @mediaforge/auth db:migrate
DATABASE_URL="<neon_direct_url>" pnpm --filter @mediaforge/service db:migrate
```

迁移完成后，应用服务继续使用 pooled URL。

## 前端回填

auth 和 service 域名确定后，在 Cloudflare Worker Builds 的前端构建变量中设置：

```text
NEXT_PUBLIC_AUTH_URL=https://<auth-domain>
NEXT_PUBLIC_SERVICE_URL=https://<service-domain>
```

然后重新触发前端 Worker 构建。

## 验证

1. 打开前端 Worker 地址。
2. 登录初始管理员账号。
3. 进入后台确认用户、模型、用量页面可加载。
4. 上传一张图片，确认 R2 中出现对象。
5. 发起一次创作任务，确认 worker 日志出现 `creation_run_completed`。

## 回滚

- Railway 服务回滚到上一个部署版本。
- 前端 `NEXT_PUBLIC_*` 回滚到上一组后端域名并重建。
- 数据库迁移当前没有 down migration，执行前必须确认生产库备份。
