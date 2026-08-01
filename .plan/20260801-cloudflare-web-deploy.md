# L 级改动计划：前端接入 Cloudflare Workers 部署

## 需求背景

用户希望将当前 MediaForge 项目部署到 Cloudflare。经分析，当前仓库包含 Next.js 前端、Node 后端服务、Node 鉴权服务和 BullMQ 后台 worker。完整生产部署涉及服务边界、数据库、对象存储、Redis/队列和密钥管理，属于 L 级改动。

本计划仅实施第一阶段：把 `apps/web` 配置为可通过 Cloudflare Workers + OpenNext 部署。后端、鉴权服务、数据库、Redis、对象存储和 AI 调用链路保持现状，只通过环境变量让前端指向未来的线上 API。

## 分级结论

```text
需求分级：L
分级理由：新增 Cloudflare/OpenNext 外部依赖和部署配置，影响生产部署流程。
影响范围：apps/web 部署脚本、Cloudflare Worker 配置、前端部署说明、锁文件。
是否需要人工确认：是
```

## 非目标

- 不迁移 `apps/service` 到 Cloudflare Workers。
- 不迁移 `apps/auth` 到 Cloudflare Workers。
- 不替换 PostgreSQL、Redis、BullMQ、MinIO/S3 或模型网关。
- 不修改 API 契约、数据库 schema、鉴权逻辑或用户可见业务流程。
- 不直接部署到生产域名，除非用户明确要求继续执行 deploy。

## 影响面

| 领域 | 是否影响 | 说明 |
| --- | --- | --- |
| 前端 | 是 | 增加 Cloudflare Workers/OpenNext 部署配置和脚本。 |
| 后端服务 | 否 | 不修改 `apps/service`。 |
| 共享契约 | 否 | 不修改 `packages/contracts`。 |
| 数据库 schema | 否 | 不新增迁移。 |
| 对象存储 | 否 | 后续可将 S3 参数指向 R2，本阶段不改。 |
| Redis / 队列 | 否 | 后续可使用 Upstash 或迁移 Queues，本阶段不改。 |
| AI 调用链路 | 否 | 不修改模型网关配置。 |
| 权限 / 安全 | 是 | 仅涉及部署环境变量说明，提醒不要提交密钥。 |
| 部署 / 环境变量 | 是 | 新增 Workers 部署配置和 runbook。 |
| 文档 | 是 | 新增 Cloudflare 部署 runbook。 |

## 方案设计

推荐使用 Cloudflare 官方当前建议的 Next.js 部署方式：`@opennextjs/cloudflare` adapter + `wrangler`。`apps/web` 仍保留原有 `next dev` 本地开发脚本，新增：

- `preview`：构建并在 Cloudflare Workers runtime 中本地预览。
- `deploy`：构建并部署到 Cloudflare Workers。
- `cf-typegen`：根据 Wrangler 配置生成 Cloudflare 环境类型。

`wrangler.jsonc` 采用 Cloudflare 推荐的新 JSONC 配置，启用 `nodejs_compat`，设置当前兼容日期，并指向 OpenNext 产物。

## 契约与数据变更

无 contracts、API schema、数据库 schema、对象存储路径或事件格式变更。

## allowed_files 草案

```yaml
allowed_files:
  - .plan/20260801-cloudflare-web-deploy.md
  - pnpm-workspace.yaml
  - apps/web/package.json
  - apps/web/wrangler.jsonc
  - apps/web/open-next.config.ts
  - apps/web/cloudflare-env.d.ts
  - docs/runbooks/cloudflare-web-deploy.md
  - pnpm-lock.yaml
verification:
  - pnpm --filter @mediaforge/web typecheck
  - pnpm --filter @mediaforge/web build
  - pnpm --filter @mediaforge/web preview
  - pnpm --filter @mediaforge/web exec wrangler deploy --dry-run
```

## 实施步骤

1. 给 `apps/web` 安装 OpenNext Cloudflare adapter 和 Wrangler 开发依赖。
2. 如 registry 出现 AWS/Smithy 最新依赖解析窗口问题，在根 `package.json` 增加最小 `pnpm.overrides` 固定 OpenNext 间接依赖。
3. 新增 `open-next.config.ts` 和 `wrangler.jsonc`。
4. 更新 `apps/web/package.json` 脚本。
5. 新增 Cloudflare 前端部署 runbook，说明环境变量、preview、deploy 和后端依赖。
6. 运行最小验证命令。

## 验证方案

- 类型检查：`pnpm --filter @mediaforge/web typecheck`
- Next 构建：`pnpm --filter @mediaforge/web build`
- OpenNext 预览构建：`pnpm --filter @mediaforge/web preview`
- Worker 打包校验：OpenNext 构建通过后执行 `pnpm --filter @mediaforge/web exec wrangler deploy --dry-run`
- 不自动生产 deploy，除非用户再次确认。

## 迁移与回滚

无数据迁移。回滚方式是移除新增 Cloudflare 配置、脚本和依赖，并恢复 `pnpm-lock.yaml`。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| `NEXT_PUBLIC_*` 在构建期未设置 | 线上前端可能仍指向 localhost | runbook 明确要求部署构建前设置变量，Workers Builds 也需配置 Build Variables。 |
| 后端尚未线上部署 | 前端可部署但核心 API 不可用 | 本阶段只完成前端托管；后端 URL 后续填入。 |
| OpenNext 对部分 Next.js 特性有限制 | 某些 SSR/中间件行为可能异常 | 使用 `preview` 在 workerd runtime 验证。 |
| Cloudflare 登录或账号权限不足 | 无法执行 deploy | 先完成本地配置和检查，deploy 作为人工确认后的动作。 |

## AI 自审

```text
AI 自审结论：通过
分级复核：新增外部依赖和部署配置，按 L 级处理合理。
服务边界：本阶段不改变服务边界，只部署前端。
契约与数据：无契约、schema 或数据迁移。
异常路径：后端未部署、环境变量缺失、Cloudflare 授权失败均在 runbook 和最终报告说明。
安全风险：不提交密钥；仅记录公开 URL 型环境变量示例。
测试方案：类型检查、Next build、Wrangler check、OpenNext preview 构建。
反方意见：完整上 Cloudflare 应一并规划后端和数据层；本阶段选择前端先行，降低风险。
需要人工重点看的问题：后端最终托管位置和线上 API 域名。
```

## 人工确认

```text
审核结论：已确认
确认人：用户
确认时间：2026-08-01
备注：用户回复“按照你的方案操作”，确认按第一阶段前端 Cloudflare Workers 部署方案推进。
```
