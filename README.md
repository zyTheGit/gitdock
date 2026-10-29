# Git Graph

Windows 优先的单窗口 Git 图谱桌面应用。图谱、提交详情、三点/两点对比、搜索与少量写操作（cherry-pick / revert / switch）集中在一个界面里；只读走 gix，写操作全部通过 Git CLI 的参数数组执行，不经过 shell。

## 功能

- 仓库图谱：范围切换、分支过滤、分页加载、稳定 lane、文件监听与自动刷新
- 提交详情：message / parents / 文件列表、单文件 diff、Shiki 语法高亮
- 对比：Base / Compare 双槽、三点 diff、两点快照、分支对比弹窗、路径过滤、外部工具拉起
- 搜索：message / hash 前缀 / author / 路径，结果直接在主图谱定位
- 分支描述、外部 diff 工具配置、写前 Gate（cherry-pick / revert / switch）

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2 |
| 前端 | React 18 + TypeScript 5.6 + Vite 5 |
| 图谱布局 | 纯函数 crate `graph-layout` |
| 只读 Git | gix（只读） |
| 写操作 | Git CLI（参数数组，固定工作目录，不经 shell） |
| 语言 | Rust stable |

## 环境要求

- Windows 10/11，WebView2 运行时
- Node.js >= 24.0.0，npm >= 11.0.0（CI 使用 Node 24）
- Rust stable，附带 `rustfmt` 与 `clippy` 组件（建议用 [rustup](https://rustup.rs/) 安装）
- Git >= 2.30.0（低于该版本只读可用、写操作禁用）
- Tauri 的 Windows 构建依赖：MSVC 构建工具与 Windows SDK，详见 [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## 快速开始

```bash
# 安装依赖
npm install

# 开发运行
npm run tauri dev

# 带仓库路径启动（启动参数优先于“恢复上次仓库”）
npm run tauri dev -- -- -- "C:/path/to/repo"

# 全量校验：前端构建 + cargo fmt --check + clippy -D warnings + workspace 测试
npm run check

# 打包 release（Windows 下需先退出正在运行的 exe）
npm run tauri build
```

## 目录结构

```text
src/                    # 前端
  app/                  # 会话、分栏、写流程与外壳组件
  features/graph/       # 图谱虚拟列表、行渲染、悬浮卡、分页
  features/detail/      # 提交详情、文件 diff、语法高亮、并排分栏
  features/compare/     # 双槽、对比弹窗、文件与 commit 列表
  features/search/      # 搜索弹框与候选生成
  features/settings/    # 外部工具、监听与恢复选项
  features/write/       # 写确认框与结果展示
  shared/               # IPC 唯一入口、DTO 类型、通用 UI
  styles/               # 按层叠顺序 @import 的样式片段
crates/
  git-core/             # 公共 DTO、Oid 校验、错误码、cursor
  git-read/             # GitReadModule 与 gix adapter（只读）
  graph-layout/         # 图谱 lane 纯函数
  git-write/            # GitWriteModule、写前 Gate、CLI adapter
  refresh/              # RefreshCoordinator（generation 与旧结果丢弃）
  fixture-gen/          # 测试夹具生成
src-tauri/              # Tauri command、会话状态、监听、配置与日志
docs/                   # 架构、任务拆分、验证记录与交接文档
```

## 开发约束

- gix 只读；所有写操作（cherry-pick / revert / switch 等）必须走 Git CLI 的参数数组，不经 shell。
- 前端不执行任意命令、不拼接 shell、不访问 `.git` 内部路径、不解析 Git 对象。
- 状态类命令使用 `GIT_OPTIONAL_LOCKS=0`，避免创建 `index.lock` 触发刷新自激循环；该变量不得用于写操作。
- 写操作前先过 Gate；冲突后只展示状态与终端提示，绝不自动 `--abort` / `--quit`。
- 只实现需求文档定义的范围，不扩展 P1/P2；不复制参考项目的代码、资源、样式或测试夹具。

## 文档

- 交接文档：[docs/05-交接文档.md](docs/05-交接文档.md)（当前状态、验证记录、已知限制）
- 需求与冻结：[需求文档.md](需求文档.md)、[docs/01-需求冻结.md](docs/01-需求冻结.md)
- 架构与任务：[docs/03-技术架构.md](docs/03-技术架构.md)、[docs/04-任务拆分.md](docs/04-任务拆分.md)
- 选型研究：[docs/02-选型终审.md](docs/02-选型终审.md)、[docs/spike-research.md](docs/spike-research.md)
- 验证记录：[docs/verification/](docs/verification/)
