# 中间对话工作区测试方案

## 测试目标

验证中间区域从创作表单升级为聊天式工作区后，用户消息、AI 流式回复、多 Agent 任务卡、追问卡和右侧预览之间的边界正确。

## 测试范围

| 范围 | 验证点 |
| --- | --- |
| 前端状态 | 消息插入、SSE 事件归并、任务卡更新、追问恢复。 |
| 前端布局 | 中间区域独立滚动，底部输入固定，整体页面无主滚动条。 |
| 后端事件 | assistant message、task card、clarification、artifact、run 状态事件。 |
| 内容边界 | 最终文章不包含用户原始输入、执行计划、AI 过程或审阅说明。 |
| 兼容 | 旧事件可映射到新任务卡，但不在右侧展示任务状态。 |
| 空会话 | 页面初始状态只存在前端，不创建后端 Conversation。 |
| 历史 | 首次发送后出现，按最后用户交互时间排序，不自动打开最近项。 |
| 资源 | 上传后持久化，最多展示 4 张缩略图和 `+N`。 |
| 删除 | 最小删除单元为 Conversation，消息和已发送资源不可单删。 |
| 顶部账户区 | 顶部不展示假状态和重复新建按钮，展示账户头像，下拉面板提供设置类入口和退出登录。 |

## 单元测试

- `chatReducer` 根据 `assistant.message.created` 插入空 AI 消息。
- `chatReducer` 根据 `assistant.message.delta` 追加内容。
- `chatReducer` 根据 `assistant.message.completed` 结束流式状态。
- `chatReducer` 根据 `task.card.updated` 创建或更新任务卡。
- `chatReducer` 在 `run.completed` 后收起任务卡并插入结果通知。
- `chatReducer` 将 `decision.required` 兼容映射为追问卡。

## 组件测试

- 每次进入页面默认展示本地空会话，不自动恢复最近历史。
- 空会话只展示引导和底部输入框，数据库不新增 Conversation。
- 发送后立即出现用户消息。
- 首次发送成功后才创建历史项，失败时不产生空历史。
- AI 流式消息逐字或分片追加。
- 任务卡在运行中展开，完成后收起。
- 当前 Agent 自动展开并实时追加安全推理摘要和阶段。
- Run 完成后全部 Agent 自动收起；失败 Agent 保持展开。
- 20 秒无新增量时显示仍在处理，heartbeat 到达后更新时间。
- 页面刷新和 SSE 重连后按 eventNo/sequence 恢复，不重复摘要。
- 追问卡展示建议选项和自由输入。
- 右侧预览不展示任务状态。
- 资源超过 4 张时只展示前 4 张和准确 `+N`。
- 顶部栏右侧展示账户胶囊，包含头像和 chevron。
- 点击账户区域展开账户面板，包含 `admin`、`Owner`、`默认团队`、`账号安全`、`权限范围`、`系统设置`。
- 点击面板底部 `退出登录` 调用 logout 并跳转登录页。

## 接口与事件测试

- 创建 Run 后能收到 `task.card.updated`。
- 可见 AI 回复按 `created -> delta -> completed` 顺序出现。
- Artifact 创建后推送 `artifact.created`。
- Run 完成后推送 `run.completed`。
- Run 失败后推送 `run.failed`，并包含可恢复错误信息。

## 端到端测试

主路径：

```text
输入公众号创作需求
-> 用户消息出现
-> AI 可见回复流式输出
-> 任务卡步骤更新
-> 右侧手机预览生成文章
-> 任务卡收起
-> 对话中出现结果通知
```

追问路径：

```text
输入模糊需求
-> AI 提示需要补充信息
-> 出现追问卡
-> 用户回答
-> 原 Run 恢复
-> 最终生成预览
```

失败路径：

```text
生成过程中发生可恢复错误
-> 任务卡显示失败
-> 对话中出现可理解的错误说明
-> 右侧预览不显示半成品为最终内容
```

## 回归重点

- 不允许右侧预览重新出现“任务已完成 / N 个步骤”。
- 不允许最终文章正文包含“我将为你”“执行计划”“审阅结果”等过程文本。
- 不允许发送按钮只触发右侧预览而不产生对话消息。
- 不允许 SSE 断开后造成任务卡永久运行中。
- 不允许模型流结束或 SSE 暂时安静时把 Run 当作完成。
- 不允许任务卡展示原始思维链、raw JSON、系统 prompt 或 Skill 完整指令。
- 不允许完成后的多个 Agent 面板继续全部展开占用对话空间。
- 不允许追问被当作计划确认。
- 不允许页面初始化或“新建创作”创建空 Conversation。
- 不允许 AI / Worker 更新改变历史列表顺序。
- 不允许已发送消息或资源出现独立删除入口。
- 不允许顶部栏继续展示 `准备就绪` 状态文本。
- 不允许顶部栏继续展示重复的 `新建创作` 按钮。
- 不允许退出登录藏在多级菜单中；账户面板打开后必须直接可见。

## 验证命令

实现阶段至少运行：

```bash
pnpm --filter @mediaforge/contracts typecheck
pnpm --filter @mediaforge/service typecheck
pnpm --filter @mediaforge/web typecheck
pnpm --filter @mediaforge/service test
```

新增前端测试后补充：

```bash
pnpm --filter @mediaforge/web test
```
