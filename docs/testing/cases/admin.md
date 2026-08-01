# 测试用例：系统设置

| ID | 场景 | 预期 |
| --- | --- | --- |
| ADM-001 | 普通用户访问 `/admin/users` | 页面返回客户端首页，接口返回 403。 |
| ADM-002 | 创建大小写重复用户名 | 返回 `USERNAME_CONFLICT`。 |
| ADM-003 | 新用户以 `12345678` 登录 | 登录成功但业务 API 返回 `AUTH_PASSWORD_CHANGE_REQUIRED`。 |
| ADM-004 | 正式密码少于 9 位或字符类别不足三类 | 返回 `AUTH_PASSWORD_POLICY_VIOLATION`。 |
| ADM-005 | 管理员禁用自己 | 返回 `SELF_ADMIN_CHANGE_FORBIDDEN`。 |
| ADM-006 | 降级最后一个有效管理员 | 返回 `LAST_ADMIN_REQUIRED`。 |
| ADM-007 | 重置密码 | 标记必须改密，全部 session 和 refresh token 被撤销。 |
| ADM-008 | 创建模型连接 | 数据库为 GCM 密文，响应只含 `secretConfigured=true`。 |
| ADM-009 | 生产环境配置 HTTP Base URL | 返回 `MODEL_BASE_URL_HTTPS_REQUIRED`。 |
| ADM-010 | 未测试连接绑定模型 | 模型验证返回 `MODEL_CONNECTION_NOT_ACTIVE`。 |
| ADM-011 | 纯文本模型绑定多模态路由 | 返回 `MODEL_CAPABILITY_MISMATCH`。 |
| ADM-012 | 使用过期版本切换路由 | 返回 `MODEL_CONFIG_CONFLICT`。 |
| ADM-013 | 默认路由缺失后生成 | 返回 `GENERATION_MODEL_UNAVAILABLE`，不读取旧环境变量。 |
| ADM-014 | 同一 Run 重复接受 | `generation_usage_events` 只有一条。 |
| ADM-015 | 一次 Run 内发生多个模型调用 | 生成次数为 1，模型调用按真实次数累计。 |
| ADM-016 | 供应商未返回 usage | token 字段为不可用，不做估算。 |
| ADM-017 | 查询超过 180 天 | 返回 `USAGE_RANGE_INVALID`。 |
| ADM-018 | running 调用超过 15 分钟 | 标记失败并写 `STALE_RUNNING_RECONCILED`。 |
