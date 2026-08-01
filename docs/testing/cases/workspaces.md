# 测试用例：工作区

## 模块文档

- `docs/modules/workspaces/README.md`

## 当前状态

已补充工程竖切样板测试用例。

## 用例

| 用例 | 层级 | 输入 | 期望 |
| --- | --- | --- | --- |
| 创建工作区默认值 | 契约测试 | 只传 `name`、`industry`、`scenario` | 自动补齐 `memoryEnabled=true`、空模块和禁用词 |
| 空工作区名称 | 契约测试 | `name` 为空字符串 | schema 校验失败 |
| 构建工作区 profile | 后端单测 | 已校验创建请求 | 返回包含指定 id、名称和默认记忆开关的 profile |

## 后续用例

- 创建工作区成功后写入 PostgreSQL。
- 用户超过工作区数量限制时返回配额错误。
- 工作区归属不匹配时禁止读取或编辑。
- 前端 API client 收到非法响应时抛出校验错误。
