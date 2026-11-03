# ADR-0005：src-tauri 平台适配层（platform 模块）

- 状态：已接受（2026-11-03，G3）
- 关联：docs/08 §3.3（PlatformAdapter 职责表）、docs/09（G2 差距清单 A-1/A-2/A-3、F-5）

## 背景

G2 Spike 的三路调查（docs/09）确认：业务 crate（git-read/git-write/graph-layout/refresh）零 OS 分支，但 src-tauri 内仍有四处平台耦合散落在业务文件中——终端 Shell 模式硬编码 PowerShell（terminal.rs，非 Windows 上 Shell 完全不可用）、`open_url` 三分支写在 external.rs、`same_path` 按 Windows 大小写不敏感语义折叠（Linux 上会错误去重两个真实仓库）、外部工具探测表仅 Windows 实现（tools.rs `#[cfg(not(windows))]` 返回空）。docs/08 §3.3 要求把这些平台行为收敛到 src-tauri 内部的平台适配层，不得散落在 commands 或 React 中。

## 决策

1. **新模块 `src-tauri/src/app/platform/`**，按关注点分文件：`shell.rs`（默认 Shell 解析）、`url.rs`（打开 URL）、`paths.rs`（路径比较语义与 PATH 工具函数）、`tools.rs`（常见外部工具探测表）。
2. **编译期 `cfg` 分派的纯函数，不做 trait 运行时注入。** 理由：每个函数都有三平台真实变体（满足 docs/08「新 seam 应有真实多实现」的要求），但变体在编译期已知、无第二实现或运行时替换需求；cfg 分派零成本且符合 Rust 惯例。可替换性由函数参数与 `#[cfg(test)]` 测试保证。
3. **职责与各平台行为**（对齐 docs/08 §3.3 表）：

   | 函数 | Windows | macOS | Linux |
   |---|---|---|---|
   | `default_shell()` | System32 绝对路径 PowerShell + UTF-8 编码参数（现逻辑迁移；防当前目录劫持） | `$SHELL`（校验绝对路径且存在）回落 `/bin/zsh` | `$SHELL` 回落 `/bin/bash` |
   | Shell 参数 | `-NoLogo -NoExit -Command <UTF-8>` | `-l`（登录环境，读 .zprofile 拿 PATH） | `-l`（读 .bash_profile/.profile） |
   | `open_url(url)` | rundll32 FileProtocolHandler | `open` | `xdg-open` |
   | `same_path(a,b)` | 分隔符归一 + 大小写折叠 | 同 Windows（默认卷不敏感） | 精确比较（大小写敏感 FS） |
   | `detect_tools()` | LOCALAPPDATA/ProgramFiles 已知路径 | /Applications 已知路径 + 固定 bin 路径 | PATH 绝对条目扫描 |

4. **探测安全模式不变**：只检查已知安装路径、PATH 只保留绝对条目、绝不启动进程（延续 terminal.rs 的防劫持约定）。
5. **前端对应物**：`src/shared/platform.ts` —— 启动时由 `AppInfoDto.platform`（`os-arch`，取 `-` 前段）注入一次，导出同步 getter `currentPlatform(): "windows" | "macos" | "linux"`；**禁用 `navigator.platform/userAgent` 嗅探**（前端现状零使用，维持）。平台条件文案（⌘/Ctrl、安装指引等）消费该 getter，不引入 React 状态（OS 不运行时变化）。
6. **消费方改造**：terminal.rs（Shell 分支）、external.rs（open_url 迁入）、config/tools.rs（探测委托）、config/recent.rs（same_path 委托）只保留业务语义，OS 差异全部指向 platform 模块。错误码与 i18n key 不变（`errors.terminalPowershellNotFound` 变为 Windows 专属路径）。

## 边界维持

- 业务 crate 维持零 OS 分支（G2 已确认现状即如此，本 ADR 不引入新例外）。
- React 视图无 OS 分支逻辑，只有文案的平台条件选择。
- Git 调用链（参数数组、`git_command()`）不变；PTY（portable-pty）、文件监听（notify）、目录 API（Tauri path）已天然跨平台，不纳入本模块。

## 明确延后项

- **Unix 进程组回收（killpg/setsid）**：portable-pty 的 `Child` trait 仅有 `kill()`；Unix 下孙进程过继行为需实机验证后另行决策，不在本 ADR 盲写代码（G4/G5 实机阶段处理）。
- **macOS 最低系统版本**：G4 实测后冻结。
- **快捷键 Meta/⌘ 支持**：独立设计决策（牵动 parseSpec/formatCombo/存储格式），另行 ADR；本 ADR 只提供前端平台 getter 供其消费。

## 验证

Windows 本地完整门禁（`npm run check`）+ CI 三平台矩阵（cfg 分支在 macOS/Linux 上的编译与 clippy 由 CI 保证；运行时行为待 G4/G5 实机）。