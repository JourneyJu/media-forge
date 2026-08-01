# Cloudflare 前端部署

本文档记录 `apps/web` 部署到 Cloudflare Workers 的第一阶段方案。

## 当前范围

本阶段只部署 Next.js 前端。`apps/service`、`apps/auth`、`apps/worker`、PostgreSQL、Redis、对象存储和模型网关仍需单独部署或配置。

## 前置条件

1. 已登录 Cloudflare：

   ```bash
   pnpm --filter @mediaforge/web cf:whoami
   ```

2. 线上后端和鉴权服务已准备好 HTTPS 地址。

3. 构建前设置前端公开变量，避免生产包内仍指向 localhost：

   ```bash
   $env:NEXT_PUBLIC_SERVICE_URL="https://service.example.com"
   $env:NEXT_PUBLIC_AUTH_URL="https://auth.example.com"
   ```

   使用 Workers Builds 时，也需要在 Cloudflare Dashboard 的 Build Variables and secrets 中配置同名变量。

## 本地验证

```bash
pnpm --filter @mediaforge/web typecheck
pnpm --filter @mediaforge/web build
pnpm --filter @mediaforge/web preview
```

`preview` 会执行 OpenNext 构建，并使用 Wrangler 在本地 workerd runtime 中启动预览。

如果只想校验 Worker 打包而不发布，先运行一次 OpenNext 构建，再执行：

```bash
pnpm --filter @mediaforge/web deploy:dry-run
```

OpenNext 在 Windows 上可能因 symlink 权限或兼容性问题失败。遇到 `EPERM: operation not permitted, symlink` 时，优先在 WSL、CI 或启用开发者模式的 Windows 环境中运行 `preview` / `deploy`。

## 部署

确认 `NEXT_PUBLIC_SERVICE_URL` 和 `NEXT_PUBLIC_AUTH_URL` 指向线上服务后执行：

```bash
pnpm --filter @mediaforge/web deploy
```

第一次部署会创建名为 `mediaforge-web` 的 Worker，并发布到 Cloudflare 分配的 `*.workers.dev` 地址。自定义域名可在 Cloudflare Dashboard 或 Wrangler 路由配置中继续添加。

## 后续生产化事项

- 后端 Node 服务托管：Railway、Fly.io、Render、VPS 或 Cloudflare Containers。
- PostgreSQL：Neon、Supabase 或通过 Cloudflare Hyperdrive 连接外部 Postgres。
- 对象存储：将 `S3_*` 指向 Cloudflare R2 的 S3 兼容接口。
- Redis/BullMQ：先用 Upstash Redis 兼容，后续评估迁移到 Cloudflare Queues / Workflows。
- 登录 Cookie：后端 `WEB_ORIGIN` 必须配置为前端 HTTPS 域名。
