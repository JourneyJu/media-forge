# 测试用例：AI 生成

## 模块文档

- `docs/modules/ai-generation/README.md`

## 当前状态

## 用例

| ID | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| AIG-001 | 生成初版 | 输入主题、卖点、素材和 skill | 创建 job，成功后生成文章版本。 |
| AIG-002 | 对话修订 | 对当前版本发送修改指令 | 创建新版本，原版本保持不变。 |
| AIG-003 | 非法 JSON | 模型返回非 JSON 内容 | job 失败，错误为 `GENERATION_OUTPUT_INVALID`。 |
| AIG-004 | 非法结构 | 模型返回缺少必填块字段 | job 失败，不保存坏版本。 |
| AIG-005 | 模型超时 | 模型网关超时 | 返回 `GENERATION_MODEL_TIMEOUT`。 |
| AIG-006 | 配额不足 | 工作区配额不足 | 返回 `GENERATION_QUOTA_EXCEEDED`，不调用模型。 |
| AIG-007 | 密钥不泄露 | 模型配置错误 | 错误信息和日志不包含 API Key。 |
| AIG-008 | Prompt 快照 | 生成成功 | prompt 快照写对象存储，且不包含密钥。 |
| AIG-009 | 生成执行计划 | 素材分析完成 | 保存 AgentPlan，右侧步骤接口返回计划摘要。 |
| AIG-010 | 排版先于扩充 | 执行 layout 和 expanding | layout 只产出 ArticleOutline，扩充后才形成完整正文。 |
| AIG-011 | 局部问题循环 | 审阅返回 `revise` | 定向修订后重新审阅，结构不变。 |
| AIG-012 | 结构问题循环 | 审阅返回 `restructure` | 保存新骨架版本，重新扩充并审阅。 |
| AIG-013 | 循环上限 | 重构达到 2 次仍不通过 | 进入 waiting_user，保留最佳版本。 |
| AIG-014 | 评分停滞 | 连续两次评分不提升 | 暂停并请求用户选择。 |
| AIG-015 | 用户确认 | waiting_user 时提交 approve | 校验 lockVersion 后继续计划指定步骤。 |
| AIG-016 | 重复决定 | 使用相同 idempotencyKey 重试 | 返回首次结果，不重复推进状态。 |
| AIG-017 | 决定版本冲突 | 使用旧 lockVersion 提交 | 返回 `AGENT_RUN_VERSION_CONFLICT`。 |
| AIG-018 | 运行中取消 | expanding 时取消 | 后续步骤停止，已保存版本保留。 |
| AIG-019 | 步骤重试 | Worker 在保存版本后重试 | 幂等键阻止重复版本。 |
| AIG-020 | 思维链保护 | 查询步骤和错误 | 只返回计划与依据摘要，不返回原始思维链。 |
