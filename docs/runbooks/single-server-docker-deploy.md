# 单台服务器 Docker + Nginx 部署

本文记录 MediaForge 改为单台服务器部署的生产方案。当前方案使用 Nginx 统一代理，先只开放 80 端口。

## 服务器建议

最低可用：

```text
2 核 CPU / 4GB 内存 / 80GB SSD
Ubuntu 22.04 或 24.04 LTS
```

更稳建议：

```text
2 核 CPU / 8GB 内存 / 100GB SSD
```

## 部署组件

生产 compose 会启动：

```text
Nginx
Next.js web
auth
service
worker
PostgreSQL
Redis
MinIO
```

所有浏览器请求走同一个 HTTP 入口：

```text
http://146.56.198.214
```

Nginx 路由：

- `/auth/*` -> auth
- `/conversations*`、`/runs*`、`/upload-sessions*`、`/resources*`、`/ai/*`、`/admin/model-*` -> service
- `/admin/usage*` 按 `Accept` 头区分页面导航和 API 请求：页面走 web，接口走 service
- 其他路径 -> web

## 端口

服务器安全组需要开放：

```text
80/tcp
22/tcp
```

不要向公网开放 PostgreSQL、Redis、MinIO。

## 服务器准备

安装 Docker 和 Compose plugin。

```bash
apt update
apt install -y ca-certificates curl git openssl
curl -fsSL https://get.docker.com | sh
docker version
docker compose version
```

## 准备配置

克隆仓库：

```bash
git clone https://github.com/JourneyJu/media-forge.git
cd media-forge
```

创建生产环境变量：

```bash
cp infra/docker/.env.prod.example infra/docker/.env.prod
```

生成 RSA 私钥：

```bash
openssl genrsa 2048 | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}'
```

分别生成两次，填入：

```text
AUTH_JWT_PRIVATE_KEY_PEM=
AUTH_PASSWORD_PRIVATE_KEY_PEM=
```

修改 `infra/docker/.env.prod`：

```text
PUBLIC_ORIGIN=http://146.56.198.214
POSTGRES_PASSWORD=强密码
MINIO_ROOT_PASSWORD=强密码，至少 16 位
AUTH_BOOTSTRAP_ADMIN_PASSWORD=初始管理员强密码
```

不要提交 `infra/docker/.env.prod`。

## 启动

```bash
docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml up -d --build
```

查看日志：

```bash
docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml logs -f
```

## 本地 CI/CD

服务器本地发布脚本：

```bash
bash scripts/deploy-prod.sh
```

脚本会执行：

- `git pull --ff-only`
- 校验 compose 配置
- 构建 web、auth、service、worker 镜像
- 启动或更新容器
- 检查 `/health` 和 `/auth/password-key`

## 验证

健康检查：

```bash
curl -fsS http://146.56.198.214/auth/password-key
curl -fsS http://146.56.198.214/health
```

浏览器打开：

```text
http://146.56.198.214
```

使用 `AUTH_BOOTSTRAP_ADMIN_ACCOUNT` 和 `AUTH_BOOTSTRAP_ADMIN_PASSWORD` 登录。首次登录后按页面提示修改密码。

## 备份

PostgreSQL：

```bash
docker exec mediaforge-postgres pg_dump -U mediaforge mediaforge > backup.sql
```

MinIO 数据保存在 Docker volume `mediaforge-prod_minio-data`。生产建议定期做磁盘快照，或者后续迁移到云对象存储。

## 回滚

```bash
git checkout <上一版提交>
docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml up -d --build
```

数据库迁移没有自动 down migration。回滚前先确认数据库备份。
