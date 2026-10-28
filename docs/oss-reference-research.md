# Git Graph 开源参考与复用调研

> 日期：2026-10-28  
> 范围：只评估引用、依赖或借鉴的可行性；本文件不构成第三方代码引入决定。锁定依赖版本前仍须再次核对 LICENSE 与传递依赖。

## 结论

建议采用“**自研 Git DAG 布局与 Rust 领域层 + 引入小而独立的前端组件**”的路线。提交图谱的拓扑顺序、跨页稳定轨道和 Git 状态机是本项目的核心差异，不适合交给通用节点图框架；虚拟滚动、diff 结构化渲染和语法高亮则适合优先使用成熟依赖。

| 领域 | 建议 | 原因 |
|---|---|---|
| 图谱布局与连线 | 自研；参考 VS Code Git Graph 的行为 | 需按 Git DAG、增量分页和稳定 lane 定制 |
| 提交列表虚拟化 | POC `@tanstack/react-virtual` | MIT、headless，适合承载提交行和文件列表 |
| unified / split diff | POC `react-diff-view` | MIT，提供 Git patch 解析、hunk 与行号模型 |
| 代码高亮 | POC Shiki | MIT，基于 TextMate grammar；需审计 grammar 许可证 |
| Git CLI 命令层 | 自研 Rust 门面；借鉴 Lazygit 分层 | 当前需求要求 Rust 和严格写前 Gate |

## 可直接依赖或纳入 POC

### `@tanstack/react-virtual`

- **许可证**：MIT。[许可证](https://raw.githubusercontent.com/TanStack/virtual/main/LICENSE)
- **可用功能**：headless 的垂直、水平和 grid 虚拟化，适用于 commit 行、文件列表和 diff 可视行窗口。[项目说明](https://github.com/TanStack/virtual)
- **接入边界**：Rust 后端仍按页返回 DTO；前端只能虚拟化已取得的数据，不能把完整历史传进 WebView。
- **POC**：验证可变高度 commit message、滚动定位搜索命中项，以及 generation 变化时清空旧缓存。

### `react-diff-view`

- **许可证**：MIT。[许可证](https://raw.githubusercontent.com/otakustay/react-diff-view/master/LICENSE)
- **可用功能**：解析 Git diff，渲染 hunk、old/new 行号，并提供行内编辑标记等增强工具。[项目 README](https://github.com/otakustay/react-diff-view)
- **接入边界**：后端只传单文件 patch 和元数据；二进制、超大文件、gitlink、编码无法可靠解析的内容继续走本项目降级提示。
- **POC**：分别验证 5,000 行与 50,000 行 patch、split/unified 视图、超长单行与 CRLF；不通过预算则保留其 patch 解析思路，自研可视行渲染。

### Shiki

- **许可证**：核心仓库为 MIT。[许可证](https://raw.githubusercontent.com/shikijs/shiki/main/LICENSE)
- **可用功能**：基于 TextMate grammar 的语法高亮。[项目说明](https://github.com/shikijs/shiki)
- **接入边界**：grammar 来自不同上游，需按其[语言与许可证说明](https://github.com/shikijs/shiki/blob/main/docs/languages.md)生成第三方通知；MVP 只打包实际支持的语言。
- **POC**：worker 或按需加载路径中高亮可视行，禁止主线程一次处理完整大 diff。

## 只可借鉴思路，不能直接移植

### VS Code Git Graph（`mhutchie/vscode-git-graph`）

- **可借鉴**：Git 图谱轨道分配、分支/标签标记、提交详情和操作入口交互。[仓库](https://github.com/mhutchie/vscode-git-graph)
- **限制**：LICENSE 明确不授予发布、分发、再许可或销售衍生作品的权限。[LICENSE](https://github.com/mhutchie/vscode-git-graph/blob/develop/LICENSE)
- **结论**：只将其作为黑盒交互与算法行为参考；不复制代码、样式、图标或派生实现。

### Lazygit（`jesseduffield/lazygit`）

- **许可证**：MIT。[许可证](https://raw.githubusercontent.com/jesseduffield/lazygit/master/LICENSE)
- **可借鉴**：其将 Git 命令、操作系统命令、异步任务、刷新与 GUI context 分开的组织方式；尤其是操作后只刷新受影响模型的边界。[代码库指南](https://github.com/jesseduffield/lazygit/blob/master/docs/dev/Codebase_Guide.md)
- **限制与结论**：实现语言为 Go、界面是 TUI；借鉴分层与测试 fixture 设计，在 Rust 自研 `GitReadService`、`GitWriteService`、`OperationState`、`RefreshCoordinator`，不复制业务代码。

### GitButler（`gitbutlerapp/gitbutler`）

- **可借鉴**：Tauri + Rust 桌面 Git 客户端的工程组织与 commit-graph 可视化开发流程。[仓库](https://github.com/gitbutlerapp/gitbutler)、[图谱开发说明](https://github.com/gitbutlerapp/gitbutler/blob/master/DEVELOPMENT.md)
- **限制**：当前为 FSL-1.1-MIT，禁止与其产品实质相同的竞争性用途；虽在两年后转换为 MIT，但不等同于当前可自由复用。[LICENSE](https://raw.githubusercontent.com/gitbutlerapp/gitbutler/master/LICENSE.md)
- **结论**：不纳入依赖、不复制代码或资源；仅作为公开行为和架构取材来源。

## 不建议作为 MVP 核心依赖

React Flow、AntV G6、GitGraph.js 都有 MIT 许可来源：[React Flow](https://github.com/xyflow/xyflow)、[G6](https://github.com/antvis/G6)、[GitGraph.js](https://github.com/krayon/gitgraphjs)。但不建议用它们承载主提交图谱：

- 它们的通用节点图模型会与本项目的按拓扑分页、稳定轨道契约重叠；
- GitGraph.js 更适合从应用内提交动作构造图，不能替代从任意已有仓库逐页读取 DAG、处理 ref 标记和大仓库虚拟化的领域层；
- 引入后仍无法消除自研 lane 分配，反而增加包体和状态同步面。

## 推荐实现切分

```text
Rust / Tauri
  GitReadService (gix) ──> GraphPage DTO ──> React
  GitWriteService (Git CLI) ──> OperationState ──> Toast / 恢复横幅
  GraphLayout（自研、纯函数） ──> lane / edge / pending edge

React
  @tanstack/react-virtual ──> commit / 文件 / diff 行窗口
  react-diff-view（POC） ──> 单文件 patch 结构和 hunk 视图
  Shiki（按需、worker） ──> 可视代码行高亮
```

## 引入门槛

1. 锁定版本仍为 MIT、Apache-2.0 或项目可接受的许可证；记录版本与第三方通知。
2. S2 POC 证明组件不会迫使完整图谱或完整大 diff 在前端常驻。
3. 图谱布局、写前 Gate、操作状态机和命令参数组装保持自有实现与测试覆盖。
4. 不从 VS Code Git Graph 或 GitButler 复制代码、样式、图标、测试夹具或资源。
