# ADR 005: Conversation 作为用户可见创作空间和删除聚合根

## 状态

Accepted

## 日期

2026-07-27

## 背景

现有设计同时存在机构级 `Workspace`、创作 `Conversation` 和前端“当前工作空间”三个概念。前端通过 `default-workspace` 和预先创建空 Conversation 维持页面状态，导致：

- 用户未发送请求也可能产生后端记录。
- “新建工作空间”和历史会话语义重复。
- 首次消息、资源绑定和 Run 创建是多个独立请求，容易部分成功。
- 删除会话时无法明确是否应删除资源、文章和对象快照。
- Worker 的更新时间可能意外改变历史列表排序。

## 决策

用户可见的“创作空间”统一由 `Conversation` 表达。未发送的空窗口只存在于前端本地，不创建任何后端实体。

`Conversation` 同时是：

- 当前 AI 上下文边界。
- 历史列表记录。
- 用户可继续发起请求的创作空间。
- Message、Resource、Run、Artifact、Article 和对象快照的删除聚合根。

机构、门店或品牌上下文不参与会话列表；其内部实体可以继续存在，但不得通过默认 Conversation 或用户可见“工作空间”表达。

## 创建决策

首次用户 Turn 使用一个原子 API 创建 Conversation、首条 Message、资源关系、Run 和 dispatch outbox。不得再先创建空 Conversation。

Conversation 标题保存首条用户 prompt 原文，创建时间取首次请求的服务端事务时间。历史排序使用独立 `last_interaction_at`，且只有成功用户 Turn 可以更新。

## 资源决策

Conversation 创建前上传的资源由用户级 `UploadSession` 暂存。原文件和预览图立即保存到 MinIO / S3，PostgreSQL 保存元数据和状态。

首次或后续 Turn 成功后，Resource 永久绑定一个 Conversation 和一条 Message。第一阶段不支持跨 Conversation 共享 Resource，以保证会话删除语义确定。

## 删除决策

Conversation 是最小删除单元。消息和已发送资源不提供独立删除。

删除采用 PostgreSQL 删除 Outbox：

1. Conversation 标记为 `deleting` 并从列表隐藏。
2. Outbox 固化全部对象 key。
3. Worker 幂等删除对象。
4. 成功后硬删除整个 PostgreSQL 聚合。

## 备选方案

### 保留默认 Workspace 和空 Conversation

实现改动较小，但继续保留重复概念、假默认数据和空历史问题，不采用。

### 选择文件后仅保存在浏览器，发送时再上传

链路简单，但刷新会丢失未发送资源，也不满足上传后立即持久保存，不采用。

### 资源属于账户素材库并允许跨会话共享

可减少重复上传，但删除 Conversation 时需要引用计数、保留策略和用户确认，第一阶段复杂度过高，暂不采用。

### 同步删除数据库和 MinIO

接口语义直观，但对象存储无法与 PostgreSQL 形成分布式事务，失败后容易出现半删除状态，不采用。

## 影响

- 移除产品主链路中的 `default-workspace` 和空 Conversation 创建。
- Conversation API 从 CRUD 空壳改为首次 Turn 聚合写入。
- 新增 UploadSession、MessageResource 和 ConversationDeletionOutbox。
- 前端每次进入页面默认展示本地空会话，历史列表独立加载。
- 新增对象存储客户端依赖和删除 Worker 任务。
- 旧工作区 API 不再承担用户会话列表职责。

## 关联

- 规格：`docs/specs/007-conversation-lifecycle-and-resource-ownership.md`
- 实施计划：`.plan/20260727-conversation-lifecycle-resource-ownership.md`
- 多 Agent ADR：`docs/adr/004-langgraph-bullmq-multi-agent-architecture.md`
