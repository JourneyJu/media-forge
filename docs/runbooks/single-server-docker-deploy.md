# 单台服务器 Docker + Nginx 部署

本文记录 MediaForge 改为单台服务器部署的生产方案。当前方案使用 Nginx 统一代理。没有域名时，可以先使用 HTTPS + IP + 自签名证书，浏览器会提示证书风险，手动继续后即可使用浏览器 WebCrypto。

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

所有浏览器请求走同一个 HTTPS 入口：

```text
https://146.56.198.214
```

Nginx 路由：

- `/auth/*` -> auth
- `/conversations*`、`/runs*`、`/upload-sessions*`、`/resources*`、`/user-skills*`、`/ai/*`、`/admin/model-*` -> service
- `/admin/usage*` 按 `Accept` 头区分页面导航和 API 请求：页面走 web，接口走 service
- 其他路径 -> web

## 端口

服务器安全组需要开放：

```text
80/tcp
443/tcp
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

生成 IP 自签名证书：

```bash
mkdir -p infra/docker/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout infra/docker/certs/server.key \
  -out infra/docker/certs/server.crt \
  -subj "/CN=146.56.198.214" \
  -addext "subjectAltName=IP:146.56.198.214"
chmod 600 infra/docker/certs/server.key
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

生成模型配置加密根密钥：

```bash
openssl rand -base64 32
```

填入：

```text
MODEL_CONFIG_ENCRYPTION_KEY=
```

`MODEL_CONFIG_ENCRYPTION_KEY` 用于加密控制台保存的模型供应商 API Key，不是 DeepSeek 或 OpenAI API Key。该值必须长期固定；如果更换，数据库中已保存的模型连接密钥将无法解密。

修改 `infra/docker/.env.prod`：

```text
PUBLIC_ORIGIN=https://146.56.198.214
POSTGRES_PASSWORD=强密码
MINIO_ROOT_PASSWORD=强密码，至少 16 位
AUTH_BOOTSTRAP_ADMIN_PASSWORD=初始管理员强密码
MODEL_CONFIG_ENCRYPTION_KEY=openssl rand -base64 32 的输出
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
curl -fsSk https://146.56.198.214/auth/password-key
curl -fsSk https://146.56.198.214/health
```

浏览器打开：

```text
https://146.56.198.214
```

浏览器首次访问会提示证书不受信任。确认是自己的服务器 IP 后，选择继续访问。

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
