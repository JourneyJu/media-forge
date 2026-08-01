# Cloudflare 前端正式部署

本文记录 `apps/web` 通过 Cloudflare Workers + OpenNext 正式部署的配置。不要把 Cloudflare Pages 的 `typecheck` 成功当作正式发布；Pages 只能说明 GitHub 集成已连通，Next.js SSR/中间件等正式产物应由 Workers 部署。

## 当前范围

本阶段只部署 Next.js 前端 `apps/web`。

暂不包含：

- `apps/service`
- `apps/auth`
- `apps/worker`
- PostgreSQL / Redis / S3 / MinIO / Model Gateway

前端上线后，登录和业务 API 仍依赖线上后端地址。

## 仓库配置

关键文件：

- `apps/web/wrangler.jsonc`
- `apps/web/open-next.config.ts`
- `apps/web/package.json`
- `package.json`

当前 Cloudflare adapter 版本：

```text
@opennextjs/cloudflare 1.19.11
```

该版本匹配项目当前的 Next.js `15.5.x`。不要降回 `1.6.x`，旧版本可构建但可能在 Cloudflare Worker 运行时抛 1101。

Worker 名称必须与 `apps/web/wrangler.jsonc` 的 `name` 一致：

```text
media-forge
```

## Cloudflare Workers Builds 配置

在 Cloudflare Dashboard 中创建或连接 Worker，而不是 Pages 项目。

推荐配置：

```text
Project type: Workers
Worker name: media-forge
Repository: JourneyJu/media-forge
Branch: main
Root directory: /
Install command: pnpm install --frozen-lockfile
Build command: pnpm cf:web:build
Deploy command: pnpm cf:web:deploy
```

说明：

- `pnpm cf:web:build` 会进入 `@mediaforge/web`，执行 `opennextjs-cloudflare build`，生成 Worker 和静态资产产物。
- `pnpm cf:web:deploy` 会上传上一步生成的 OpenNext/Workers 产物。
- Workers Builds 会在 Cloudflare 的 Linux 构建环境里执行，不依赖本机 Windows。
- Worker 名称必须是 `media-forge`，否则 Workers Builds 会因为 Wrangler 配置名称不匹配而失败。

## 环境变量

在 Workers Builds 的 Build Variables and secrets 中配置：

```text
NEXT_PUBLIC_SERVICE_URL=https://你的后端服务域名
NEXT_PUBLIC_AUTH_URL=https://你的鉴权服务域名
```

这些变量用于 Next.js 构建期内联。它们不是运行时 Worker 变量。

如果后端还没有线上地址，可以先使用占位 HTTPS 地址完成前端部署，但相关业务能力会不可用。

## 本地验证

```bash
pnpm cf:web:typecheck
pnpm cf:web:build
pnpm --filter @mediaforge/web build
```

更接近生产的本地预览：

```bash
pnpm --filter @mediaforge/web preview
```

Windows 下 OpenNext 可能在 Next standalone trace 阶段遇到 symlink 权限问题，例如 `EPERM: operation not permitted, symlink`。正式部署以 Cloudflare Workers Builds 的 Linux 环境结果为准。

## 发布触发

提交并推送到 `main` 后，Workers Builds 会自动拉取代码并执行：

```bash
pnpm install --frozen-lockfile
pnpm cf:web:build
pnpm cf:web:deploy
```

成功后访问 Cloudflare 分配的 `*.workers.dev` 地址，或在 Worker 中绑定自定义域名。

## Pages 项目处理

当前已有 Pages 项目 `media-forge`，它的成功部署地址类似：

```text
https://9e9b3e59.media-forge.pages.dev
```

该项目可以暂时保留作为 GitHub 集成验证，但不要作为正式 Next.js 生产入口。正式入口应使用 `media-forge` Worker 的部署地址。
