# 测试方案：创作会话与任务

## 目标

验证无默认会话、首次 Turn 原子建档、真实历史排序、消息不可变、资源归属、多 Agent 流式恢复和会话级删除闭环。

## 单元测试

- 首条 prompt 原文生成 Conversation 标题。
- `lastInteractionAt` 只由用户 Turn 更新。
- 历史游标按 `lastInteractionAt DESC, id DESC` 稳定排序。
- Message 创建后无更新或删除业务入口。
- staged Resource 只能绑定当前用户且只能归属一个 Conversation。
- Conversation 状态机只允许 `active → deleting`。
- 删除 Outbox object keys 快照完整且去重。
- 首次和后续 Turn 幂等键去重。

## 事务集成测试

- 首次 Turn 在一个事务中创建 Conversation、Message、MessageResource、Run 和 dispatch outbox。
- Run / outbox 写入失败时整个事务回滚，不留下空 Conversation。
- Resource 校验失败时不创建 Conversation，staged Resource 保持可重试。
- 后续 Turn 成功后 Message、Run、contextVersion 和 lastInteractionAt 一致提交。
- 后续 Turn 创建 Run 时读取 Working Memory，并将本次上下文冻结到 `graph_runs.context_json`。
- 并发重复首次 Turn 只创建一个 Conversation。

## 历史与恢复测试

- 用户没有 Conversation 时返回空数组。
- 页面加载历史不会创建或激活 Conversation。
- 首次发送后历史新增一条，创建时间等于首条消息时间。
- 历史 Conversation 再次发送后移动到第一条。
- Assistant、RunEvent、Artifact 和 Worker 状态更新不改变排序。
- `GET /conversations/:id` 恢复 Message 及其 Resources、active Run 和 Artifact。
- 页面刷新后同一 Conversation 的 Working Memory 可恢复，不依赖前端内存。

## 会话记忆测试

- 第一轮生成完成后，Working Memory 写入 brief、标题、提纲摘要、正文摘要和 `lastArtifactId`。
- 后续 RunContext 使用模型辅助 `instructionMemory = 结构化 rebuiltContext + 最近 1 到 2 条有价值用户输入原文`，前端消息历史保持完整展示。
- 用户只发送“继续任务”等短指令时，RunContext 仍保留前序长 prompt 的有价值内容，不让短指令覆盖创作主题。
- 完整、自洽的新提示词在同一 Conversation 中也必须解析为新创作，不得因存在历史而继承旧主题。
- 上一轮 Run 失败后，只有“重试”“重新生成”等明确操作指令复用 `lastAttempt.resolvedRequest`；新的完整需求不复用失败请求。
- IntentResolver 判断同主题/新主题结果必须冻结到 `graph_runs.context_json.intentResolution`，用于审计和复现。
- 用户明确切换新主题时，IntentResolver 判定为 `new_creation`，清空旧主题上下文。
- 当前短指令没有可继承历史需求且置信度低时，进入 clarification，不生成“未指定主题”的泛化文章。
- 资源上下文使用 `resourceContext` 传递 `resourceId`、绑定关系、元数据和派生摘要，不用文本 rebuild 替代原始资源。
- 新主题默认不继承历史资源；继续或修改任务只能继承用户显式选择资源或上一版 Artifact 已使用资源。
- 素材摘要缺失或低质量时，Material / Vision Agent 可按 `resourceId` 重新读取原始资源或预览资源。
- 修改类 Turn 能识别 `revise_existing`，并在 RunContext 中包含上一版 Artifact 引用。
- 新主题 Turn 能识别 `new_creation`，避免错误沿用上一版正文。
- RunContext 创建后保持冻结，后续用户消息不影响正在执行的 Run。
- 新建 Conversation 不继承旧 Conversation 的 Working Memory。
- Conversation 删除时清理对应 Working Memory。

## V2 规范化请求与兼容测试

- 首次 Turn、后续 Turn 和兼容持久化入口都通过同一个 Creation Context Assembler，等价输入生成等价请求。
- V2 RunContext 必须携带 `schemaVersion=2` 和合法 `resolvedRequest`，当前 Turn 只出现一次。
- `off` 执行 V1；`shadow` 生成 V2 诊断但 Worker 仍执行 V1；`explicit` 只对显式模式执行 V2；`all` 按稳定 Conversation 分桶执行。
- 同一 Conversation 的百分比分桶结果稳定，不因进程重启或 Run 次数改变。
- 旧 Artifact 缺少 `creationSnapshot` 时，仅呈现修订不得进入短路路径，应安全降级到完整兼容路径。
- 成功 Run 更新 `successfulBaseline`；失败 Run 只更新 `lastAttempt`，较旧 contextVersion 的迟到写入不能覆盖较新记忆。
- clarification 恢复后更新同一冻结请求的 operation 和约束，不重新拼接全部历史消息。

## SSE 与多 Agent 回归

- RunEvent 递增编号和断线补发。
- Assistant delta 完成后保存不可变 Assistant Message。
- 任务卡和追问事件只属于当前 Conversation。
- 最终 Article 不包含用户 prompt、AI 过程或审阅说明。

## 删除测试

- 删除返回 `202` 后历史立即隐藏。
- deletion outbox 固化全部 Resource、HTML、prompt 和输出快照 key。
- Worker 重复执行对象删除保持幂等。
- MinIO 暂时失败时 Conversation 保持 deleting，任务重试。
- 对象删除成功后 Conversation 聚合最终硬删除。
- Message、attached Resource、Run 和 Artifact 没有独立删除接口。

## 权限与安全

- 不能读取、发送到或删除其他用户 Conversation。
- 不能绑定其他用户或其他 Conversation 的 Resource。
- 删除接口不泄露无权限 Conversation 是否存在。
- RunEvent 和 Assistant Message 不包含密钥、原始思维链和未脱敏 prompt。
- `run.failed.failure` 只包含安全 code、stage、category、recoverability 和 violation code，不包含供应商原始错误或堆栈。

## 验证命令

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service test
pnpm --filter @mediaforge/worker test
pnpm --filter @mediaforge/web test
pnpm typecheck
pnpm test
pnpm build
```
