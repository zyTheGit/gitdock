# ADR 0023：工作区面板与顶栏改造（多标签底部面板 + 顶栏精简 + Shell 下拉）

- 状态：PR-2 主体已实现（2026-11-06，分支 `feature/bottom-panel`，待 GUI 实机验收）
- 日期：2026-11-05（裁决）、2026-11-06（实施）
- 影响范围：`src/features/terminal/`（面板容器与工具栏）、`src/features/gitlog/`（日志组件挂载形态）、`src/app/TopBar.tsx`、`src/app/StatusBar.tsx`、设置分区（Shell Profile 入口）、`src-tauri/src/app/menu/`（ADR-0012 设置入菜单栏）、i18n（terminal/gitlog/shell 域）、`docs/verification/GUI-实机验收清单.md`
- 关联：ADR-0012（设置入口收进应用菜单栏，已裁决继续实施）

## 1. 背景与目标

当前底部只有单一终端面板，命令日志为居中弹窗；顶栏按钮含搜索、暂存区、对比、终端、设置、刷新共 6 个，入口分散。用户参考 VS Code 底部面板设计，要求：

1. 终端与命令日志统一进底部面板（多标签结构）。
2. 终端 Shell 切换入口从设置移到面板工具栏，默认 Git Bash。
3. 顶栏按钮精简，减少交互层级。
4. 设置入口收进菜单栏（ADR-0012 已裁决）。

## 2. 决策

### 2.1 底部面板多标签结构

- 固定标签页：`终端 | 命令日志`，共享现有面板的高度、拖拽与持久化。
- 命令日志从居中弹窗迁入底部面板，复用现有搜索/筛选/清空/展开/复制逻辑，组件挂载形态由 Dialog 改为 Panel。
- 标签切换快捷键避开 LazyGit 常用键；`Ctrl+`` 开合面板语义不变；Esc 分层保持。
- 不做多输出通道/多终端实例的下拉选择器（当前仅 1 个终端会话 + 1 个日志源，无可切换对象）。

### 2.2 LazyGit 手动调起

- LazyGit 不作为固定标签页自动启动；由用户手动调起（打开终端标签或 LazyGit 入口）。
- 终端标签内保留 LazyGit / Shell 模式与 `terminal_mode` 设置；LazyGit 启动后占用终端标签，切换标签不杀进程（resume 语义保留）。

### 2.3 Shell 下拉入终端工具栏

- 终端工具栏新增 Shell 类型下拉：Windows 显示 `Git Bash`（默认）/ `PowerShell`；macOS/Linux 显示 `$SHELL`。
- **默认 Shell 仅 Windows 改为 Git Bash**；macOS/Linux 继续 `$SHELL`。
- **切换后立即重启当前 PTY 会话**（单会话模型），提示「切换 Shell 将重启当前终端会话」；选择持久化到 `settings.json` 的 `shell_profile`。
- **设置中的 Shell Profile 入口移除**，只保留面板内下拉。
- **不考虑老用户**：不做老 `shell_profile=powershell` 设置迁移，新默认直接生效。

### 2.4 顶栏精简（2026-11-05 随 ADR-0012 修订更新）

- 顶栏按钮保留：搜索 | 暂存区 | 对比 | 刷新 | 设置。
- 移除：终端按钮（入口已由底部面板标签 + 状态栏终端图标 + `Ctrl+`` 承载）。
- 设置按钮回归顶栏（ADR-0012 修订后 Windows/Linux 无窗口菜单栏，设置不能再由菜单承载）。
- 分层原则：顶栏 = 主视图切换 + 刷新 + 设置；状态栏 = 辅助入口（终端图标、日志、更新）；macOS 应用菜单 = 设置/关于/退出；底部面板 = 终端与日志。

### 2.5 设置入口（ADR-0012 修订后）

- Windows/Linux：顶栏设置按钮（刷新右侧）+ `Ctrl+,` 快捷键；无原生菜单栏。
- macOS：保留原生应用菜单（GitDock → 设置… / 关于 GitDock / 退出 GitDock；文件 → 打开仓库）。
- 「关于」/ 检查更新 / 反馈统一在设置弹窗「关于」分区，不再有独立 About 弹窗。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 仅美化终端面板、日志仍弹窗 | 未达成「日志纳入面板」目标 |
| 多输出通道 + 下拉选择器 | 当前仅 1 个终端会话 + 1 个日志源，无可切换对象 |
| LazyGit 固定标签页自动启动 | 全屏 TUI 默认占据面板、常驻成本、焦点/键盘冲突；手动调起更符合预期 |
| Shell 切换仅下次启动生效 | 单会话模型下切换感弱；立即重启当前会话更直观 |
| 保留 TopBar 设置/终端按钮 | 与菜单栏、底部面板入口重复，违背精简目标 |

## 4. 影响与拆分建议

建议拆为两个 PR，降低单次改动面：

1. **PR-1（ADR-0012，已修订）**：设置入口方案经 2026-11-05 修订——Windows/Linux 移除原生菜单栏、设置按钮回归顶栏、顶栏移除终端按钮；原 PR #18（菜单栏方案）已关闭，修订方案重新开 PR。
2. **PR-2（本 ADR 主体）**：底部面板多标签 + 日志迁入 + LazyGit 手动调起 + Shell 下拉（默认 Git Bash、切换重启会话）。

PR-2 依赖 PR-1 的设置入口落位，避免顶栏设置按钮悬空。

## 5. 验收标准

1. 底部面板出现「终端 | 命令日志」标签；日志搜索/筛选/清空/展开/复制在面板内正常。
2. LazyGit 手动调起后进入终端标签，切换标签不杀进程。
3. Shell 下拉默认 Git Bash（Windows），切换后当前会话重启为新 Shell 并持久化；设置中无 Shell Profile 入口。
4. 顶栏保留搜索/暂存区/对比/刷新/设置；终端按钮消失；状态栏终端图标与 `Ctrl+,` 设置快捷键正常；Windows/Linux 无原生菜单栏（深色模式无白色横条），macOS 应用菜单正常。
5. `npm run check` 全绿；GUI 实机验收按清单补测（面板切换、Shell 切换重启、顶栏精简）。
## 6. 实施记录（2026-11-06，分支 feature/bottom-panel）

- **共享外框 `BottomPanel`**（`src/features/panel/BottomPanel.tsx` + `panel.css`）：标签栏（ARIA tablist、roving tabindex、方向键/Home/End）、高度拖拽（沿用 `gitdock.terminal.height` 与 140 下限）、面板级全屏（仅终端标签可用，切日志/收起自动退出）、收起按钮；`Ctrl+PageUp/PageDown` 切标签为新增固定键位（弹窗打开时不触发，已进设置固定键位说明）。
- **面板状态 `useBottomPanel`**（`src/app/useBottomPanel.ts`）：面板开合不持久化，活动标签持久化到 `gitdock.bottomPanel.activeTab`；首次打开某标签才挂载对应 View，此后收起只 hidden 保活（终端 PTY 不杀、日志筛选状态保留）。
- **`TerminalView`**（`src/features/terminal/TerminalView.tsx`）：原 TerminalPanel 的内容部分迁入，外框职责上交 BottomPanel；根类改 `.terminal-view`。切标签期间 View 持续挂载，`visible = 面板开 && 终端标签活动` 驱动 xterm fit/focus 生命周期。
- **`CommandLogView` + `useCommandLog`**（`src/features/gitlog/`）：命令日志从 Modal 弹窗迁入面板标签；每次标签激活重拉快照、切换保留搜索/筛选/展开状态；删除 `CommandLogDialog.tsx`；gitlog.css 去弹窗宽高改填充式。
- **Shell 下拉 `ShellProfileSelect`**（仅 Windows 渲染，`src/features/terminal/ShellProfileSelect.tsx`）：会话运行中两段确认（对齐日志清空模式，3 秒超时回落）；LazyGit 运行中禁用并提示，绝不静默杀进程；未启动时只保存。
- **`set_shell_profile` command**（对齐 set_language 模式）：后端读最新设置只改单字段，复用白名单校验与原子保存，返回完整 SettingsDto；不触发 watcher 重启。前端保存成功后仅 Shell 模式下 `start("shell")` 重启（start 内含旧会话清理与迟到会话防护）。
- **默认值**：`default_shell_profile()` 平台化（Windows→git_bash，其余→default）；显式保存过 `"default"` 的老设置不改写（测试锁定）；Git Bash 探测失败时 `resolve_shell` 自动回退 PowerShell（不再报错，错误 key 保留供异常场景）。
- **设置分区**：移除 Shell Profile Select 与草稿字段（`TerminalSection.tsx`/`useSettingsDraft.ts`/`SettingsDialog.tsx`），`...settings` 透传面板内保存的最新值。
- **Esc 分层**：`TERMINAL_PANEL_SELECTOR` 升级为 `BOTTOM_PANEL_SELECTOR`（`.bottom-panel`），焦点在面板内（终端或日志视图）时界面层统一让路；终端全屏 Esc 还原上移至 BottomPanel。
- **状态栏**：终端与日志按钮均为「活动则收起、否则切标签并展开」语义，日志按钮补 active/aria-pressed 态。
- 验证：`npm run check` 七项全绿（含 cargo test 65 通过、clippy 0 警告）；release 构建 exe 启动、进程存活正常。CDP 深度 DOM 验证受本机环境干扰未稳定连通，交互项（标签切换保活、Shell 重启、全屏、窄窗口）按 GUI 清单留待实机验收。