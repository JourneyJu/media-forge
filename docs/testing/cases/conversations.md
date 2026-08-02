# 测试用例：创作会话与任务

| ID | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| CONV-001 | 初次进入页面 | 用户无历史并打开创作页 | 数据库不新增 Conversation，历史返回空数组，前端显示本地空会话。 |
| CONV-002 | 有历史时重新进入 | 用户已有多条历史并重新打开页面 | 历史按更新时间展示，但当前仍是新的本地空会话，不自动打开第一条。 |
| CONV-003 | 首次发送 | 提交 prompt 和幂等键 | 原子创建 Conversation、首条 Message、Run 和 outbox；标题等于 prompt 原文。 |
| CONV-004 | 首次发送带资源 | 上传 2 张图片后首次发送 | 两个 Resource 与首条 Message 和 Conversation 绑定，响应可恢复缩略图。 |
| CONV-005 | 首次发送失败 | 模拟 Run outbox 写入失败 | 全事务回滚，不产生历史；staged Resource 可重试。 |
| CONV-006 | 首次发送重试 | 使用同一幂等键提交两次 | 只存在一个 Conversation、Message 和 Run，第二次返回原结果。 |
| CONV-007 | 历史标题与时间 | 首次发送多行 prompt | 数据库保存首条 prompt 原文和服务端首次请求时间；前端只做单行省略。 |
| CONV-008 | 后续用户 Turn | 对旧 Conversation 再次发送 | 新 Message 和 Run 创建，`lastInteractionAt` 更新，会话移动到第一条。 |
| CONV-009 | AI 更新不重排 | Worker 写 Assistant Message、Artifact 和 run.completed | `lastInteractionAt` 不变，历史顺序不变。 |
| CONV-010 | 消息不可变 | 尝试调用消息更新或删除 | API 不存在或返回不允许，原消息保持不变。 |
| CONV-011 | 资源跨会话冲突 | 将已 attached Resource 绑定到另一 Conversation | 返回 `RESOURCE_CONVERSATION_CONFLICT`。 |
| CONV-012 | 会话恢复 | 读取包含资源和 active Run 的 Conversation | 返回有序 Messages、消息 Resources、active Run 和最新 Artifact。 |
| CONV-013 | 删除会话 | 调用 DELETE | 返回 `202 deleting`，会话立即从列表隐藏并拒绝新 Turn。 |
| CONV-014 | 删除对象失败 | MinIO 删除临时失败 | deletion job 重试，会话继续隐藏，数据库保留清理所需 keys。 |
| CONV-015 | 删除完成 | 删除 Worker 成功 | Message、Resource、Run、Artifact、Article、快照对象和 Conversation 最终不存在。 |
| CONV-016 | 重复删除 | 重复调用 DELETE 或重复消费任务 | 返回相同删除状态，不重复产生有害操作。 |
| CONV-017 | 越权访问 | 用户访问他人 Conversation | 返回 404，不泄露资源存在性。 |
| CONV-018 | SSE 续传 | 客户端从 `eventNo=2` 重连 | 只补发更大编号事件并继续流式接收，不重复消息。 |
| CONV-019 | 内容边界 | 完成公众号生成 | 最终文章不包含用户 prompt、任务计划、模型思维链或审阅说明。 |
| CONV-020 | Working Memory 写入 | 第一轮公众号生成完成 | `conversation_memories` 写入当前 brief、标题摘要、提纲摘要、正文摘要和 `lastArtifactId`。 |
| CONV-021 | 修改类 Turn | 用户在已有 Artifact 的会话中发送“标题更吸引人一点” | 新 Run 的 `context_json` 包含 Working Memory 和上一版 Artifact 引用，不重新空白生成。 |
| CONV-022 | RunContext 冻结 | Run 创建后用户立即继续发送另一条消息 | 已创建 Run 的 `graph_runs.context_json` 不变化，后一条消息创建独立上下文版本。 |
| CONV-023 | 新会话隔离 | 新建 Conversation 后发送创作需求 | 不读取旧 Conversation 的 Working Memory。 |
| CONV-024 | 删除清理记忆 | 删除包含 Working Memory 的 Conversation | Conversation 聚合清理后，对应 Working Memory 不存在。 |
