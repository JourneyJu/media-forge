# 中间对话工作区模块

## 模块定位

中间对话工作区是公众号创作主界面。它负责本地空会话、历史切换、消息流、多 Agent 任务卡、资源缩略图、追问和底部输入框。右侧手机区域只展示最终文章。

## 初始行为

- 每次进入页面都创建一个前端本地空会话，`conversationId = null`。
- 加载真实历史列表，但不自动打开最近一条。
- 未发送前不调用后端创建 Conversation。
- “新建创作”只清空本地状态，不创建后端记录。
- 用户点击历史项后才恢复对应 Conversation。

## 页面结构

```text
CreationPage
├─ Topbar
│  ├─ BrandBlock
│  └─ AccountActions
├─ ConversationHistory
│  ├─ NewCreationAction
│  └─ ConversationList
├─ ChatWorkspace
│  ├─ MessageList
│  └─ ChatComposer
└─ PreviewPanel
```

页面整体不滚动；历史列表、消息列表和手机预览各自独立滚动。

## 顶部栏

- 顶部栏左侧展示品牌区：`MediaForge` 和 `公众号创作平台`。
- 顶部栏右侧展示账户操作区，不展示页面状态文本。
- 顶部栏不展示 `新建创作` 按钮；新建入口保留在左侧历史栏。
- 账户操作区采用紧凑胶囊样式，顶部只展示头像和 chevron。
- 点击账号区域展开账户面板，面板展示 `admin`、`Owner` 和 `默认团队`。
- 账户面板第一阶段保留 `账号安全`、`权限范围`、`系统设置` 三个占位入口。
- 退出登录是账户面板底部的全宽描边按钮。
- 点击退出登录调用 auth logout，成功后跳转到 `/login`。

## 历史列表

- 只展示后端真实 `active` Conversation。
- 标题使用首条用户 prompt，前端单行省略，不改写后端值。
- 标题下展示 `lastInteractionAt`。
- 按 `lastInteractionAt DESC` 排序。
- 用户在历史会话中再次发送成功后，该项移动到第一条。
- AI 输出和任务完成不改变排序。
- 删除 Conversation 后立即从列表移除。

## 消息与任务

- 点击发送后先显示 optimistic 用户消息。
- 首次发送调用 `POST /conversations`，成功后获得真实 ID。
- 后续发送调用 `POST /conversations/:id/turns`。
- Assistant 通过 SSE delta 流式追加，只展示面向用户的文字。
- 多 Agent 进度在对话列表的任务卡中更新，完成后收起。
- 当前执行 Agent 自动展开，流式显示安全推理摘要、执行阶段、耗时和最近活动时间。
- Run 完成后全部 Agent 默认收起；失败 Agent 保持展开并显示失败阶段。
- 20 秒没有新进度时显示“模型仍在处理”，不能把 SSE 暂时无事件误判为完成。
- 只有 `run.completed`、`run.failed`、`cancelled` 或 `waiting_clarification` 可以结束当前 Run UI 状态。
- 信息不足时出现追问卡，不要求用户确认内部计划。
- 右侧手机预览只读取 Artifact / ArticleVersion。

## 资源展示

- 选择或粘贴资源后立即上传并显示状态。
- 输入区最多展示 4 个 `44 × 44` 缩略图，超过后显示 `+N`。
- 发送前可以移除 staged Resource。
- 发送成功后，资源和 prompt 一起显示在用户消息气泡中。
- 已发送资源不显示单独删除入口。
- 点击缩略图或 `+N` 打开查看层。

## 前端状态

```ts
type ChatState = {
  conversationId: string | null;
  uploadSessionId: string | null;
  messages: ChatMessage[];
  stagedResources: ResourceView[];
  activeRunId: string | null;
  result: GenerateWechatArticleResponse | null;
  status: "idle" | "uploading" | "sending" | "streaming" |
    "waiting_clarification" | "completed" | "failed";
};
```

`page.tsx` 只负责布局组合。历史、Turn 提交、上传、SSE 归并和删除分别由独立 hooks / reducer 管理。

## Optimistic 行为

- 首次发送失败：移除或标记 optimistic 消息，保持本地空会话和 staged Resources，不新增历史。
- 后续发送失败：恢复输入或提供重试，不更新历史排序。
- 删除请求成功返回 `202`：立即移除历史项；失败则恢复列表项并提示。
- SSE 断线：使用最后 `eventNo` 重连并补发，不重复插入消息。

## 内容边界

允许 Assistant 消息包含可理解的进度和结果说明。Agent 过程面板可以显示经脱敏和限长的推理摘要，但禁止包含模型原始思维链、内部 prompt、Skill 完整指令、工具参数、执行计划原文或审阅 Agent 内部报告。最终文章不得包含用户 prompt 或 AI 过程文本。

## API 与测试

- Conversation API：`docs/api/conversations.md`
- Resource API：`docs/api/assets.md`
- 测试方案：`docs/testing/plans/chat-workspace.md`
- 测试用例：`docs/testing/cases/chat-workspace.md`
