# ADR 0035：在系统文件管理器中定位仓库文件

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`src-tauri`（`app/platform/reveal.rs`、`commands/app.rs`、`lib.rs` 注册）、前端 `src/shared/ipc.ts`、暂存区文件右键菜单、i18n（errors / staging）
- 编号说明：规划文档 `docs/13` 已为 T06–T12 预留 ADR 0026–0034，本 ADR 属 T03 的补充能力，按创建顺序编号为 0035
- 触发依据：`docs/tasks/T03-暂存区提交流程与文件右键增强.md` 第 2 节「暂存区文件右键菜单」

## 1. 背景

暂存区文件列表缺少「在文件管理器中显示」入口。该能力需要新增受限 Tauri command，按架构约束必须走 `app/platform/` 平台适配层，并配 ADR 记录路径校验与启动方式。

## 2. 决策

1. **单一 command**：`reveal_in_file_manager(path)`，入参只有仓库内相对路径；不接受绝对路径、选项字符串或任意可执行文件。
2. **路径校验（平台适配层 `resolve_in_repo`）**：
   - 拒绝空串、绝对路径、盘符/UNC 前缀，以及任何 `..` 组件（逐组件检查，只允许 `Normal` 与 `.`）；
   - 仓库根与目标均 `canonicalize` 后再 `starts_with` 比对，符号链接无法逃出仓库；
   - 目标必须存在，缺失时返回 `Io` 并提供 `errors.revealFileMissing` 文案。
3. **平台实现（编译期 cfg，无运行时分支）**：
   - Windows：`explorer /select,<绝对路径>`，`/select,` 与路径拼成一个参数，含空格路径不被拆开；
   - macOS：`open -R <绝对路径>`；
   - Linux：`xdg-open <父目录>`（文件管理器无统一“选中文件”接口，退化为打开父目录）。
   - 一律 `Command` + 参数数组启动，不经过 shell；`hide_console` 避免控制台闪窗；启动后不等待退出。
4. **错误口径**：越界/非法路径 → `InvalidArgument`；文件缺失/根解析失败 → `Io`；启动失败 → `ExternalToolFailed`。所有错误带 i18n key，前端错误横幅可直接展示。
5. **只读边界**：命令不修改仓库、不读写 `.git`，仅做路径校验与进程启动。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 前端调用系统命令或自定义协议打开路径 | 违反「跨进程只走 Tauri command seam」，且无法校验越界 |
| 传入绝对路径由 Rust 直接使用 | 前端可指向仓库外任意文件，违背 command 受限原则 |
| 复用外部 diff 命令打开资源管理器 | 语义不同（需要“选中文件”），且会把工具配置耦合进来 |
| Linux 统一用 `nautilus --select` 等具体管理器 | 引入发行版依赖；`xdg-open` 父目录是通用可行解 |
