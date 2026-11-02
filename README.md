# GitDock

> 产品名：GitDock。文中的“Git Graph”指图谱视图/模块，区别于 VS Code 的 Git Graph 扩展。

Windows 优先的单窗口 Git 图谱桌面应用。图谱、提交详情、三点/两点对比、搜索与少量写操作（cherry-pick / revert / switch）集中在一个界面里；只读走 gix，写操作全部通过 Git CLI 的参数数组执行，不经过 shell。

## 功能

- 仓库图谱：范围切换、分支过滤、分页加载、稳定 lane、文件监听与自动刷新
- 提交详情：message / parents / 文件列表、单文件 diff、Shiki 语法高亮
- 对比：Base / Compare 双槽、三点 diff、两点快照、分支对比弹窗、路径过滤、外部工具拉起
- 搜索：message / hash 前缀 / author / 路径，结果直接在主图谱定位
- 暂存区：按 HEAD / Index / Worktree 展示 staged 与 unstaged 文件，文件级与批量暂存、取消暂存
- 内置终端：在当前仓库目录启动 LazyGit 或 PowerShell，终端改动会触发图谱与状态刷新
- 分支描述、外部 diff 工具配置、写前 Gate（cherry-pick / revert / switch）
- 外观跟随 Windows 浅色/深色；全局字体缩放；设置/关于显示版本并提供 Issue 入口
- 版本检查：对比本仓库 GitHub Releases 的最新标签，发现新版本时在设置与状态栏提示，安装包仍由你在浏览器中自行下载

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

## 快捷键

| 快捷键 | 行为 |
|---|---|
| `Ctrl` + `` ` `` | 展开 / 收起底部终端（状态栏右侧终端图标同效，不结束正在运行的进程） |
| `Ctrl` + `=` / `Ctrl` + `+` | 放大界面（75%–200%，固定档位） |
| `Ctrl` + `-` | 缩小界面 |
| `Ctrl` + `0` | 恢复 100% |
| `Ctrl` + 点击提交 | 依次设置对比的 Base / Compare |
| `Esc` | 关闭搜索或对比、取消待替换选择、清空双槽；终端内与暂存区自行处理 |

缩放立即生效并写入 `settings.json` 的 `font_scale`（旧配置缺省 100%）；状态栏和“设置 → 外观”都会显示当前比例。

## 版本更新

应用只回答“有没有新版本”，不下载也不安装任何东西：检查读取本仓库 GitHub Releases 的最新标签并与当前版本比较，界面里唯一的动作是在默认浏览器中打开该 Release 页面，是否下载安装包由你自己决定。

- 手动检查：设置 → 关于 → 检查更新，结果显示在同一行（已是最新版本 / 发现新版本 vX / 检查更新未成功）。
- 自动检查：应用启动后检查一次；距上次成功检查不足 24 小时则跳过，手动检查不受此限制。
- 发现新版本且未被跳过时，状态栏右侧出现“更新”标记，点击直接打开 Release 页面。
- 跳过此版本：该版本不再提示，直到出现严格更新的版本；误跳可以在「设置 → 关于」里点「撤销跳过」立即恢复提示。跳过记录与上次检查时间存 `localStorage`（`gitdock.update.lastCheckedAt` / `gitdock.update.skippedVersion`），不写入 `settings.json`。
- 版本比较按 semver：标签版本号必须严格高于当前版本才提示（`0.2.0-rc.1` 不算比 `0.2.0` 新）。
- 前提与限制：本仓库需在 GitHub 上公开可见，离线或读取失败时只在界面提示错误，不影响其他功能。

## 目录结构

```text
src/                    # 前端
  app/                  # 会话、分栏、写流程与外壳组件
  features/graph/       # 图谱虚拟列表、行渲染、悬浮卡、分页
  features/detail/      # 提交详情、文件 diff、语法高亮、并排分栏
  features/compare/     # 双槽、对比弹窗、文件与 commit 列表
  features/search/      # 搜索弹框与候选生成
  features/settings/    # 外部工具、监听、外观缩放、关于与反馈
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
