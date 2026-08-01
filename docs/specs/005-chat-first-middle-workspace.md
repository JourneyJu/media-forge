# 规格：中间区域对话式创作工作区

> 生命周期修订：初始空会话、首次发送、历史排序、资源归属和会话删除以 `docs/specs/007-conversation-lifecycle-and-resource-ownership.md` 为准。本文继续作为消息流、任务卡和手机预览交互规格。

## 背景

当前页面中间区域仍然接近“创作表单”：顶部说明、一个大输入框、上传资料、Skill 和发送按钮。右侧手机预览上方还残留任务状态，例如“任务已完成 / 4 个步骤”。

这与多 Agent 架构的产品心智不一致。用户应该在中间区域和 AI 沟通，AI 的可见回复、任务进度、必要追问也应该在中间对话列表中出现。右侧手机预览只展示公众号文章预览和 HTML，不承载任务状态。

## 目标

- 将中间区域升级为“对话流 + 多 Agent 任务卡 + 底部输入框”。
- 用户点击发送后，用户消息立即进入对话列表。
- AI 可见回复以流式消息气泡输出。
- 多 Agent 任务进度以任务卡消息展示。
- 信息不足时在对话流中展示追问卡。
- 右侧手机预览删除任务状态，只展示公众号预览、源码和复制 HTML。
- 最终公众号正文不得包含用户原始输入、执行计划、AI 过程或审阅说明。

## 非目标

- 不在此规格中实现 LangGraph 节点细节。
- 不做右侧手机预览重构。
- 不做 token 级最终正文写入。
- 不展示模型原始思维链。

## 页面分区

```text
workspace
├─ topbar
├─ workspace-rail
├─ creation-area
│  ├─ hero-copy
│  └─ chat-panel
│     ├─ chat-header
│     ├─ message-list
│     └─ chat-composer
└─ preview-panel
   ├─ preview-toolbar
   ├─ phone / source-view
   └─ compatibility
```

## 中间区域结构

### 顶部引导区

保留当前视觉风格：

```text
当前创作
今天想写什么？
告诉 AI 你的创作目的、读者和素材。系统会自动拆解任务，并生成适合手机阅读的公众号内容。
```

### 对话面板

`composer-card` 升级为 `chat-panel`：

```text
chat-panel
├─ chat-header
│  ├─ 当前创作标题
│  └─ 当前对话上下文
├─ message-list
│  ├─ user message
│  ├─ assistant streaming message
│  ├─ task card message
│  ├─ clarification card
│  └─ result notice
└─ chat-composer
   ├─ textarea
   ├─ 上传资料
   ├─ @ Skill
   └─ 发送按钮
```

`message-list` 独立滚动，`chat-composer` 固定在面板底部。

## 消息类型

```ts
type ChatMessage =
  | UserMessage
  | AssistantMessage
  | TaskCardMessage
  | ClarificationMessage
  | ResultNoticeMessage;
```

### 用户消息

```ts
type UserMessage = {
  id: string;
  type: "user";
  content: string;
  resourceIds: string[];
  createdAt: string;
};
```

### AI 可见回复

```ts
type AssistantMessage = {
  id: string;
  type: "assistant";
  content: string;
  streaming: boolean;
  runId?: string;
  createdAt: string;
};
```

AI 可见回复只能包含面向用户的进度说明，例如：

```text
我正在整理读者、活动卖点和文章结构。
这类内容适合用“场景切入 + 分类展示 + 行动引导”的方式来写。
```

不得包含：

```text
模型思考过程
内部 prompt
执行计划原文
审阅报告
工具调用参数
```

### 多 Agent 任务卡

```ts
type TaskCardMessage = {
  id: string;
  type: "task";
  runId: string;
  title: string;
  status: "queued" | "running" | "waiting_clarification" | "completed" | "failed";
  steps: TaskStepView[];
  collapsed: boolean;
  createdAt: string;
};

type TaskStepView = {
  id: string;
  label: string;
  status: "waiting" | "running" | "completed" | "failed";
  summary?: string;
};
```

默认步骤：

```text
需求理解
标题生成
结构大纲
正文写作
配图规划
内容审阅
微信排版
```

执行中展示：

```text
公众号创作任务
✓ 需求理解
✓ 标题生成
✓ 结构大纲
→ 正文写作
· 配图规划
· 内容审阅
· 微信排版
```

完成后自动收起：

```text
公众号创作任务
已完成 7 个步骤
```

### 追问卡

```ts
type ClarificationMessage = {
  id: string;
  type: "clarification";
  runId: string;
  title: string;
  description: string;
  questions: Array<{
    id: string;
    label: string;
    required: boolean;
    suggestions: string[];
  }>;
  createdAt: string;
};
```

追问卡只在信息不足时展示，不用于确认执行计划。

示例：

```text
还需要补充目标读者
为了更准确地写正文，请告诉我这篇文章主要面向谁？
[家长] [本地消费者] [老客户]
也可以自己输入...
```

### 结果通知

```ts
type ResultNoticeMessage = {
  id: string;
  type: "result_notice";
  runId: string;
  artifactId: string;
  content: string;
  createdAt: string;
};
```

示例：

```text
已生成公众号预览，可以在右侧查看和复制 HTML。
```

## 发送流程

```text
用户点击发送
→ 前端插入 user message
→ 清空输入框
→ conversationId 为空：POST /conversations（首条消息、资源和 Run 原子创建）
→ conversationId 存在：POST /conversations/:id/turns
→ 插入 task card message
→ 打开 GET /runs/:id/events
→ 根据 SSE 更新 AI 消息、任务卡和右侧预览
```

页面初始化和“新建创作”只创建前端本地空状态，不调用后端创建 Conversation。资源选择或粘贴后通过 UploadSession 立即持久化，发送成功后随用户消息展示。

## 事件映射

后端需要提供两类事件：

```text
AI 可见消息事件
任务进度事件
```

建议 RunEvent 扩展：

```text
assistant.message.created
assistant.message.delta
assistant.message.completed
task.card.updated
clarification.required
artifact.created
run.completed
run.failed
```

前端映射：

| 事件 | 前端行为 |
| --- | --- |
| `assistant.message.created` | 插入空 AI 气泡。 |
| `assistant.message.delta` | 追加到 AI 气泡内容。 |
| `assistant.message.completed` | 结束流式状态。 |
| `step.started` / `task.card.updated` | 更新任务卡步骤为进行中。 |
| `step.completed` | 更新任务卡步骤为完成。 |
| `clarification.required` | 插入追问卡，任务卡进入等待补充。`decision.required` 仅兼容旧服务。 |
| `artifact.created` | 拉取 artifact，更新右侧手机预览。 |
| `run.completed` | 任务卡自动收起，插入结果通知。 |
| `run.failed` | 任务卡展示失败和重试入口。 |

## 前端状态

第一阶段使用 `useReducer`，不要继续在 `page.tsx` 中堆多个互相独立的 `useState`。

```ts
type ChatState = {
  conversationId: string | null;
  activeRunId: string | null;
  messages: ChatMessage[];
  assets: LocalAsset[];
  result: GenerateWechatArticleResponse | null;
  status: string;
};
```

推荐 action：

```text
userMessageAdded
assistantMessageCreated
assistantDeltaReceived
assistantMessageCompleted
taskCardCreated
taskStepUpdated
clarificationRequired
artifactCreated
runCompleted
runFailed
assetAdded
assetRemoved
```

## 组件拆分

```text
ChatWorkspace
├─ ChatHeader
├─ MessageList
├─ MessageBubble
├─ AssistantStreamingMessage
├─ AgentTaskCard
├─ ClarificationCard
├─ ResultNotice
└─ ChatComposer

PreviewPanel
├─ PreviewToolbar
├─ PhonePreview
└─ SourceView
```

`page.tsx` 只负责组合布局和调用 hooks，不继续承载全部交互细节。

## 右侧预览边界

右侧删除：

```text
任务已完成
4 个步骤
执行计划
按计划执行
任务进度条
```

右侧保留：

```text
手机预览
源码
复制 HTML
微信兼容检查
```

## 后端配合

当前后端已有任务事件流，但缺少 AI 可见消息流。需要补充：

- Assistant message 的创建、delta 和完成事件。
- ConversationMessage 保存 AI 可见回复。
- 任务卡事件和 Agent 节点事件的映射。
- Clarification 提交后恢复 Run。

`RunEvent` 仍可作为第一阶段统一事件通道。后续复杂后再拆 `ConversationMessageEvent`。

## 验收标准

- 中间区域不再是单个大输入框。
- 发送后用户消息立即出现在对话列表。
- AI 可见回复以流式气泡出现。
- 多 Agent 任务卡出现在对话列表，不出现在右侧预览区。
- 任务卡能随 SSE 更新步骤状态。
- 任务完成后任务卡自动收起。
- 信息不足时展示追问卡。
- 右侧预览不展示任务状态和 AI 过程。
- 最终公众号正文不包含用户原始输入、执行计划、AI 过程或审阅说明。
