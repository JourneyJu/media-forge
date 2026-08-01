# 单台服务器 Docker 部署

本文记录 MediaForge 改为单台服务器部署的生产方案。

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
Caddy
Next.js web
auth
service
worker
PostgreSQL
Redis
MinIO
```

所有浏览器请求走同一个 HTTPS 域名：

```text
https://example.com
```

Caddy 路由：

- `/auth/*` -> auth
- `/conversations*`、`/runs*`、`/upload-sessions*`、`/resources*`、`/ai/*`、`/admin/model-*`、`/admin/usage*` -> service
- 其他路径 -> web

## DNS

把域名 A 记录指向服务器公网 IP。

```text
example.com A <server-ip>
```

Caddy 会自动申请 HTTPS 证书。服务器安全组需要开放：

```text
80/tcp
443/tcp
22/tcp
```

不要向公网开放 PostgreSQL、Redis、MinIO。

## 服务器准备

安装 Docker 和 Compose plugin。

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

重新登录 SSH 后检查：

```bash
docker version
docker compose version
```

## 准备配置

克隆仓库：

```bash
git clone git@github.com:JourneyJu/media-forge.git
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
APP_DOMAIN=你的域名
PUBLIC_ORIGIN=https://你的域名
POSTGRES_PASSWORD=强密码
MINIO_ROOT_PASSWORD=强密码
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

## 验证

健康检查：

```bash
curl -fsS https://你的域名/auth/password-key
curl -fsS https://你的域名/health
```

浏览器打开：

```text
https://你的域名
```

使用 `AUTH_BOOTSTRAP_ADMIN_ACCOUNT` 和 `AUTH_BOOTSTRAP_ADMIN_PASSWORD` 登录。首次登录后按页面提示修改密码。

## 更新发布

```bash
git pull
docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml up -d --build
```

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
