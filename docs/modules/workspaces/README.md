# 模块：品牌上下文（过渡期 Workspace）

## 模块定位

本模块保存机构、校区、门店或固定公众号场景的品牌资料、目标读者、默认风格和长期偏好。数据库和旧契约暂时沿用 `Workspace` 名称，但它不是用户历史列表中的“创作空间”，也不创建默认 Conversation。

用户可见创作空间统一由 `Conversation` 表达，见 `docs/modules/conversations/README.md`。

## 职责边界

### 负责

- 品牌资料、目标读者、默认风格、固定模块和禁用词。
- 品牌长期记忆开关和摘要。
- 为当前 Conversation 提供显式选择的背景上下文。

### 不负责

- 历史会话列表。
- 创建、删除或排序 Conversation。
- 为页面初始化默认 Conversation。
- 消息、资源、文章版本或 AI Run 生命周期。

## 约束

- 前端创作页不得硬编码 `default-workspace` 以生成会话。
- 品牌上下文可选；缺少品牌配置不能阻止用户创建 Conversation。
- 品牌上下文更新不能改变 Conversation 的 `last_interaction_at`。
- 未来重命名数据库表或契约属于独立迁移，不在会话生命周期改造中同时执行。

## API 与测试

- API：`docs/api/workspaces.md`
- 测试方案：`docs/testing/plans/workspaces.md`
- 测试用例：`docs/testing/cases/workspaces.md`
