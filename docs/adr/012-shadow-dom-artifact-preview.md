# ADR 012：使用 Shadow DOM 渲染固定尺寸 Artifact 预览

## 状态

Accepted，待实施。

## 日期

2026-08-12

## 背景

公众号手机预览需要直接展示最终 Artifact HTML，并在不同桌面分辨率下保持相同内容排版。现有 iframe 会随外层手机容器缩窄而改变内部排版。产品决定桌面工作台宽度不足时使用整体横向滚动，右侧面板和 `390px` 手机内容视口保持固定。

同时，本次明确不建设可视化编辑器，也不继续使用 iframe。无 iframe 渲染必须解决主页面与文章的样式隔离，以及 HTML 注入的脚本安全问题。

## 决策

1. 手机预览继续以最终 Artifact HTML 为单一事实源，不建立独立 React Block Renderer。
2. 使用原生 Shadow DOM 隔离文章和工作台样式，手机文章视口固定为 `390 × 844 CSS px`。
3. 使用基于 DOM 解析和允许列表的 HTML 清洗器处理 Artifact HTML；Shadow DOM 不被视为安全沙箱。
4. 资源 URL 在清洗后的 DOM 中按节点解析，只接受既定可信资源路径。
5. 源码和复制功能继续使用原始 Artifact HTML，预览清洗结果只用于显示。
6. 桌面工作台保持固定三栏最小宽度，空间不足时由外层产生横向滚动，不缩放手机内容。

## 选择理由

- Artifact HTML 与复制结果同源，不会形成 React 预览和微信 HTML 两套排版实现。
- Shadow DOM 提供适合当前需求的样式隔离，并允许直接处理加载状态和资源错误。
- 固定内容视口能保证不同桌面分辨率只影响可见范围，不影响文章换行和布局。
- 安全清洗与服务端 Renderer 白名单形成纵深防御，弥补取消 iframe sandbox 后的执行风险。
- 原生 Shadow DOM 足以满足生命周期需求，无需为了包装能力再增加一个组件依赖。

## 备选方案

### 保留 iframe 并固定视口

样式和脚本隔离最强，改动也较小，但不符合本次“不使用 iframe”的产品约束，因此不采用。

### 将 ArticleDocument 渲染为 React 组件

适合未来块级编辑器，但当前会形成 React Renderer 和微信 HTML Renderer 两条实现，增加一致性成本；本次没有可视化编辑需求，因此不采用。

### 普通 DOM 注入和 CSS 前缀

实现简单，但全局继承、通用标签规则和 Artifact 内联样式仍容易相互影响，难以长期保证预览稳定，因此不采用。

### 使用设备外框组件库

设备组件只能提供手机外观，不能解决内容视口、HTML 安全或样式隔离。现有外框已满足产品需求，不为纯装饰能力引入依赖。

## 影响

- `apps/web` 新增 Shadow DOM 预览组件、HTML 清洗和 DOM 资源解析。
- `apps/web` 需要新增一个经过确认的 HTML 清洗生产依赖，优先选择 `DOMPurify`。
- 工作台响应式策略从压缩或单栏切换改为固定三栏与横向滚动。
- 不改变后端 API、Artifact 数据、数据库 schema、AI 链路或 Renderer 输出契约。

## 风险与应对

- 取消 iframe sandbox 扩大 HTML 注入风险：严格清洗标签、属性、URL 和危险样式，并保留服务端 Renderer 校验。
- 清洗器可能移除微信兼容内容：以可信 Renderer 输出建立允许列表和固定回归样本，清洗结果只用于预览。
- Shadow DOM 仍会接收部分宿主继承值：在 ShadowRoot 中显式定义字体、颜色、背景、尺寸和 box model。
- 固定三栏会在小桌面产生横向滚动：这是明确的产品取舍，以保证创作区和手机预览不变形。
- 新依赖存在供应链和升级风险：锁定版本，记录安全更新，并保持清洗策略测试。

## 关联

- `docs/specs/019-fixed-workbench-shadow-preview.md`
- `docs/modules/chat-workspace/README.md`
- `docs/testing/plans/chat-workspace.md`
- `docs/testing/cases/chat-workspace.md`

