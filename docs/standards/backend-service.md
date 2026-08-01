# 后端服务规范

本规范适用于 `apps/service`。

## 技术栈

- Node.js + TypeScript。
- PostgreSQL 保存业务事实。
- MinIO / S3 保存图片、快照、导出文件、prompt 快照和 skill 包。
- Redis 用于缓存、限流、锁、队列和短期任务状态。

## 分层

- HTTP controller：解析请求、注入上下文、调用 service、映射响应。
- service：编排业务流程、事务、AI 调用、对象存储和配额。
- policy：权限、配额、状态机、业务规则判断。
- repository：数据库读写和查询封装。
- adapter：MinIO、Redis、模型供应商等外部系统访问。
- dto / schema：请求响应校验和类型收窄。

Controller 不写复杂业务规则，repository 不做跨业务编排，adapter 不泄露第三方响应结构给上层。

## API

- 新增或修改 API 必须先更新 `packages/contracts` 和 `docs/api/`。
- 请求必须做运行时校验。
- 响应错误使用稳定错误码。
- 用户、租户、工作区上下文必须贯穿到 service、repository 和日志。

## 数据库

- SQL 和 schema 遵循 `docs/standards/sql.md`。
- 多表写入必须使用事务。
- 数据库只保存对象 key 和元数据，不保存上传文件二进制。
- schema 变化必须按 L 级流程进入 `.plan/`。

## 对象存储

- 对象 key 由后端生成，不能信任前端传入的任意路径。
- 上传文件必须记录归属、大小、类型、hash、识别状态和安全状态。
- HTML 快照和导出文件必须绑定文章版本。
- 对象写入成功但数据库写入失败时，需要补偿或标记孤儿对象。

## AI 编排

- AI 调用统一经过后端编排入口。
- 记录模型、场景、token 用量、耗时、状态和错误分类。
- prompt 快照可保存对象存储，但不得包含密钥或未脱敏敏感信息。
- 模型返回必须校验结构后再落库。
- 生成失败要区分模型失败、解析失败、配额失败、策略失败和系统失败。

## 日志与观测

- 日志遵循 `docs/standards/logging.md`。
- API 请求、上传、导出、AI 任务、配额扣减都需要可追踪。
- 不记录明文密钥、完整敏感 prompt、用户隐私或上传原始内容。

## 测试

- service / policy 覆盖核心业务规则。
- repository 覆盖关键 SQL、事务和归属过滤。
- adapter 使用可控 mock 或本地依赖验证异常路径。
- 上传、导出、文章版本、AI 编排、配额扣减需要集成测试。
