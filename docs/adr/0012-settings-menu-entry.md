# ADR 0012：设置入口收进应用菜单栏

- 状态：已实现（2026-11-05；PR-1，待 PR 合并与三平台实机验收）
- 日期：2026-11-05
- 影响范围：`src-tauri/src/app/menu/`（新增）、`src-tauri/src/lib.rs`、`src/app/TopBar.tsx`、前端菜单事件接线、`src/shared/keybindings.ts`、`src/i18n/locales/*/shell.ts`、`src-tauri/capabilities/default.json`（如需要）、`docs/03-技术架构.md`
- 触发依据：`docs/08` G0 任务 3（2026-11-03 用户裁决）、`docs/08` 第 47 行「设置入口统一位于菜单栏」

## 1. 背景

当前设置入口是 TopBar 右侧按钮（`src/app/TopBar.tsx:118`，图标 + 「设置」文案），点击后打开 `SettingsDialog`。`docs/08` 已将「设置入口统一位于菜单栏」列为既定方向，但至今未实现：Tauri 侧没有任何应用菜单构建代码，`src-tauri/capabilities/default.json` 只有窗口、WebView 缩放与目录选择权限。

本 ADR 只收敛入口位置，不改变设置分区内容、保存逻辑或 `SettingsDialog` 的行为。

## 2. 决策

### 2.1 菜单归属

| 平台 | 设置入口 | 快捷键 |
|---|---|---|
| macOS | 应用菜单「GitDock」→「设置…」 | `Cmd+,` |
| Windows / Linux | 窗口菜单栏「文件」→「设置…」 | `Ctrl+,` |

菜单同时承载现有的高频入口：打开仓库、终端、命令日志、快捷键、反馈、关于、检查更新。**不纳入「最近仓库」列表**（已有仓库切换器承载，避免动态菜单与状态同步复杂度）。Git 写操作仍只通过主界面按钮/右键菜单，不进应用菜单，避免出现第二套写操作入口。

### 2.2 入口唯一性

- **移除 TopBar 的设置按钮**，避免菜单与顶栏双入口；TopBar 的搜索、暂存、对比、终端、刷新保持不变。
- 设置快捷键从现有的按钮点击改为 `Ctrl+,` / `Cmd+,`，接入既有 keybindings 显示层映射（ADR-0006：macOS 显示 ⌘，存储规范不变）。
- 设置弹框仍由前端 `SettingsDialog` 渲染；菜单只负责发出「打开设置」意图。

### 2.3 实现方式

- 新增 `src-tauri/src/app/menu/`：用 Tauri 2 `MenuBuilder` 构建菜单，启动时 `set_menu`。
- 菜单事件：`on_menu_event` 统一发出 `app://menu` 事件（payload 为动作标识），前端 `listen` 后调用既有状态 setter；不新增通用命令执行通道。
- 语言：菜单文案使用 **Rust 侧静态文案表**（zh/en 两份），**语言切换后即时重建菜单**，与应用内语言即时生效保持一致；不采用「前端把文案传给 Rust」的方案（会扩大命令面）。
- 权限：菜单构建属于应用自有代码，不需要新增路径/命令权限；实现时确认 `core:default` 是否覆盖菜单事件，不足则补 `core:menu:*` 最小权限。

### 2.4 不改变

- 设置分区（语言、外观、终端、Git 操作、快捷键、关于）内容与保存逻辑不变。
- 不引入系统托盘菜单（不满足「应用菜单」语义）。
- 不把 Git 写操作放进应用菜单。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 保留 TopBar 按钮 + 菜单双入口 | 与「设置入口统一位于菜单栏」的裁决冲突；双入口增加发现路径分歧 |
| 仅新增菜单项、不移除按钮 | 同上，且长期会形成两套维护点 |
| 系统托盘菜单 | 托盘不是应用菜单，macOS 下也不符合平台习惯 |
| 前端把菜单文案传给 Rust command | 扩大 command seam，与「跨进程只走受限 DTO + command」边界不符 |
| 菜单纳入最近仓库列表 | 动态菜单与仓库状态同步复杂度高，且已有切换器承载 |

## 4. 后果

- TopBar 少一个按钮，设置发现路径改为菜单；需要同步快捷键、i18n、README 与用户文档。
- macOS 为原生应用菜单，Windows/Linux 为窗口菜单栏；三平台布局与快捷键需分别验收。
- 语言切换后即时重建菜单，需补测试验证 zh/en 两套文案都正确。
- `src-tauri` 新增一个纯 UI 装配模块，不改变 Git 能力边界。

## 5. 验收清单（实现完成的判定）

1. 三平台菜单可见，设置入口位于约定位置（macOS 应用菜单 / Windows、Linux「文件」）。
2. `Ctrl+,` / `Cmd+,` 打开设置；`Esc` 关闭，忙碌态不误关。
3. 中英文切换后菜单文案即时重建且正确。
4. TopBar 不再有设置按钮；搜索、暂存、对比、终端、刷新入口不受影响。
5. 菜单事件不绕过既有 generation / RefreshCoordinator 流程。
6. `npm run check` 全绿；三平台 GUI 实机验收。

## 6. 裁决记录（2026-11-05）

1. **继续实施**：按本 ADR 独立分支开发。
2. **Windows/Linux 归属「文件」**：设置入口为「文件 → 设置…」。
3. **移除 TopBar 设置按钮**：避免双入口。
4. **不纳入最近仓库列表**：只保留「打开仓库」等静态菜单项。
5. **语言切换即时重建菜单**（采纳推荐默认项，用户未提出异议）。
6. Windows 代码签名本轮裁决为「先不签」（当前外部用户为零/内测，证书成本高）。
## 7. 实现记录（2026-11-05）

- 新增 `src-tauri/src/app/menu.rs`：用原生 `Menu / Submenu / MenuItem` 构建菜单，菜单事件经 `app://menu` 发给前端；macOS 首个子菜单为应用菜单，Windows/Linux 为窗口菜单栏。
- `set_language` 成功后调用 `menu::install` 重建文案（Rust 侧 zh/en 静态表）。
- 前端新增 `useAppMenu`（事件分发）与 `useSettingsEntry`（设置开合 + `Ctrl/Cmd+,`），`TopBar` 移除设置按钮。
- `SettingsDialog` 增加 `initialSection`，菜单可直达「快捷键」「关于」分区。
- 设置 → 快捷键固定键位新增 `Ctrl/Cmd+,`。
- `npm run check` 退出码 0；待 PR 合并与三平台实机验收。