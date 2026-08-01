# TypeScript 规范

本规范适用于 `apps/web`、`apps/service` 和 `packages/contracts`。

## 类型来源

- 领域实体、请求响应、枚举、错误码优先定义在 `packages/contracts`。
- 前端和后端不得复制同一份接口类型；确有视图模型或持久化模型差异时，需要显式命名。
- 外部输入必须先校验，再进入业务逻辑；类型断言不能替代运行时校验。

## 类型设计

- 禁止默认使用 `any`。确实无法表达时，先用 `unknown`，在边界处收窄类型。
- 函数导出、公共方法、API handler、repository 方法必须有明确入参和返回类型。
- 可选字段只用于真实可缺省的场景；可为空字段使用 `null`，未传字段使用 `undefined`，不要混用含义。
- 联合类型需要有稳定判别字段，例如 `status`、`type`、`kind`。
- DTO 命名使用 `CreateXRequest`、`UpdateXRequest`、`XResponse`、`XListItem` 等清晰后缀。
- 数据库记录模型、领域模型、API 响应模型不要强行共用一个类型。

## 模块导出

- `packages/contracts` 通过统一入口导出公开契约。
- 服务内部模块优先导出必要能力，不导出临时工具和内部实现细节。
- 避免循环依赖；公共工具向下沉到本服务内部 `lib` 或共享包时必须有明确理由。

## 异步与错误

- 异步函数返回 `Promise<T>`，不要返回可能同步也可能异步的混合值。
- 不使用裸字符串抛错；使用统一错误类型或带 code 的错误对象。
- 捕获异常后如果重新抛出，需要保留原始 cause 或记录必要上下文。

## 前端补充

- React 组件 props 必须显式定义类型。
- 组件事件回调命名使用 `onXxx`，内部处理函数使用 `handleXxx`。
- 服务端返回数据进入组件前，先在 API client 或 hooks 层完成类型收窄。

## 后端补充

- Controller 层只接受已校验 DTO，不直接信任 `req.body`。
- Repository 返回持久化模型，Service 负责映射为领域模型或响应模型。
- Redis、MinIO、模型供应商响应都视为外部输入，需要校验关键字段。
