# 阶段 A：内置终端技术 Spike 报告

> 状态：通过（go）
> 分支：`spike/terminal`（Spike 代码尚未合并到 `main`）
> 日期：2026-10-30
> 对应计划：`docs/06-GitDock后续需求与执行计划.md` 阶段 A
> 结论：推荐 `portable-pty 0.9.0` + `xterm.js 6.0.0`；安装包增量 MSI +152 KiB、NSIS +136 KiB，远低于 10 MiB 门槛。LazyGit 保持外部安装、不进入安装包。

## 1. 结论摘要

1. 两个 Windows PTY 方案均通过最小探针的中文输出、ANSI 转义、resize 与退出码验证；`portable-pty` 在“进程已退出后再 kill”场景返回成功，`conpty 0.7.0` 返回 `Windows error: 拒绝访问 (0x80070005)`，回收路径更脆弱。
2. 选用 WebView 内终端模拟器（xterm.js）+ Rust 侧 PTY（portable-pty）。未采用原生独立终端窗口回退方案。
3. Release 实测：MSI 由 5,001,216 B 增至 5,156,864 B（+155,648 B，约 +152 KiB）；NSIS 由 3,431,755 B 增至 3,571,166 B（+139,411 B，约 +136 KiB）。新增体积约为门槛的 1.5%，满足“新增不超过 10 MiB”。
4. LazyGit 0.66.1 以外部可执行程序运行：可识别 PATH 与设置中的自定义路径；启动失败映射为可理解错误；退出码 0 能回传；退出后无 `lazygit.exe` 孤儿进程。
5. 终端内 `git commit` 后，GitDock 图谱在约 3 秒内自动从 1 行刷新为 2 行，复用现有 generation/refresh coordinator，未另建刷新链路。
6. 结论为 go，可进入阶段 B；需在阶段 B 补齐中文输入法实机验证、LazyGit 路径设置 UI、收起面板与结束进程的语义分离。

## 2. 方案比较

Spike 前比较两类前端形态：

- 方案 A：WebView 内终端模拟器（xterm.js）+ Rust PTY（portable-pty）。
- 方案 B：WebView 内终端模拟器（xterm.js）+ Rust PTY（conpty）。
- 方案 C：原生终端子窗口/独立窗口（回退方案，未实现）。

PTY 探针工程位于 `poc/terminal-backends/`，同一份代码通过 feature 切换后端，命令、cwd、尺寸与输入输出处理完全一致。

| 维度 | 方案 A：portable-pty 0.9.0 | 方案 B：conpty 0.7.0 | 结论 |
|---|---|---|---|
| 许可 | MIT（wezterm） | MIT（zhiburt） | 均可用 |
| 维护 | 随 wezterm 持续维护，API 覆盖跨平台 PTY | 社区个人维护，接口更薄 | A 更稳 |
| 中文输入法 | xterm.js 支持 composition；本轮未做 OS 输入法实机验证 | 同左 | 阶段 B 人工复验 |
| Unicode | 探针输出 `PROBE-中文-OK`，`HAS_CJK=true` | 同左 | 均通过 |
| ANSI | 探针输出含 ESC 序列，`HAS_ESC=true` | 同左 | 均通过 |
| 焦点与快捷键 | xterm 隐藏 textarea 接收按键；Ctrl+` 切换面板 | 同左 | 阶段 B 补 IME/焦点矩阵 |
| resize | `RESIZE=Ok(())` | `RESIZE=Ok(())` | 均通过 |
| 进程退出回收 | `EXIT=Ok(Some(3))`、`KILL=Ok(())` | `EXIT=Ok(Some(3))`、`KILL=Err(拒绝访问 0x80070005)` | A 更可靠 |
| 仓库刷新 | 终端退出与监听事件复用 RefreshCoordinator | 同左 | 均可行 |
| 最小探针体积（release，opt-level=z + LTO + strip） | 303,616 B | 215,040 B | B 小 88,576 B，但应用体积增量已远低于门槛 |
| 结论 | 采用 | 否决 | — |

说明：探针是独立小程序，体积差不等于应用体积差；安装包实测见第 4 节。

## 3. 版本与许可来源

| 依赖 | 版本 | 许可 | 来源 |
|---|---|---|---|
| portable-pty | 0.9.0 | MIT | https://github.com/wezterm/wezterm |
| conpty（仅探针对比） | 0.7.0 | MIT | https://github.com/zhiburt/conpty |
| @xterm/xterm | 6.0.0 | MIT | npm 包 `@xterm/xterm` |
| @xterm/addon-fit | 0.11.0 | MIT | npm 包 `@xterm/addon-fit` |
| LazyGit | 0.66.1（本机验证版本） | MIT | 用户自行安装，不进入安装包 |

许可信息取自本地 Cargo 注册表与 npm 包元数据；LazyGit 版本取自实际运行 TUI。未下载或捆绑 LazyGit 二进制。

## 4. 安装包体积实测

基线为提交 `3400087`（终端 Spike 之前）的 release 安装包：

| 产物 | 基线 | Spike | 差值 |
|---|---:|---:|---:|
| MSI | 5,001,216 B（4.77 MiB） | 5,156,864 B（4.92 MiB） | +155,648 B（+152 KiB） |
| NSIS | 3,431,755 B（3.27 MiB） | 3,571,166 B（3.41 MiB） | +139,411 B（+136 KiB） |
| `git-graph-app.exe` | — | 14,047,744 B | — |

Spike 包 SHA256：

```text
0ffd5152e242413bc2edd226e7598c0425fbc620ca071370e75f7143d113c1d1  Git Graph_0.1.0_x64_en-US.msi
fbf19d30dbeef83e1531686cbf097606c6468444e61c4c2ce6123d75dccbd9bd  Git Graph_0.1.0_x64-setup.exe
```

前端主 chunk 由交接文档记录的约 312 kB 增至 654,148 B（含 xterm.js 与应用代码），`dist` 总计约 3.5 MB。新增体积远低于 10 MiB 门槛，无需提交减重或外置方案。

## 5. 行为验证

### 5.1 PTY 探针对比

在仓库内启动 PowerShell，向 PTY 写入 `echo PROBE-中文-OK` 与 `exit 3`：

```bash
cd poc/terminal-backends
PROBE_SEND=$'echo PROBE-中文-OK\r\nexit 3\r\n' PROBE_SEND_AFTER_MS=800 PROBE_READ_MS=3500 \
  ./target-portable/release/terminal-probe.exe portable . powershell.exe -NoLogo -NoProfile
PROBE_SEND=$'echo PROBE-中文-OK\r\nexit 3\r\n' PROBE_SEND_AFTER_MS=800 PROBE_READ_MS=3500 \
  ./target-conpty/release/terminal-probe.exe conpty . powershell.exe -NoLogo -NoProfile
```

实测输出：

| 指标 | portable-pty | conpty |
|---|---|---|
| `EXIT` | `Ok(Some(3))` | `Ok(Some(3))` |
| `RESIZE` | `Ok(())` | `Ok(())` |
| `KILL` | `Ok(())` | `Err("Windows error: 拒绝访问。 (0x80070005)")` |
| `HAS_ESC` | `true` | `true` |
| `HAS_CJK` | `true` | `true` |

### 5.2 Release 应用端到端（CDP）

以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 release exe，通过 CDP 操作真实 WebView：

- 面板显示“以当前用户权限运行”。
- Shell 在仓库目录启动；执行 `echo SPIKE-中文-OK; git rev-parse --abbrev-ref HEAD` 输出 `SPIKE-中文-OK` 与 `spike/terminal`，验证 UTF-8 与 cwd。
- 面板高度拖到 380 px 后 xterm 重新 fit，PTY 收到 resize。
- LazyGit 0.66.1 在当前仓库渲染完整中文 TUI（状态、文件、未暂存变更、本地分支），列出 493 个变更条目；按 `q` 退出后显示 `[进程已退出，代码 0]`，按钮恢复为启动态，`tasklist` 中无 `lazygit.exe`。
- 关闭应用后无 `git-graph-app.exe` / `lazygit.exe` 残留。
- 仓库刷新：临时仓库初始 1 个提交；终端内执行 `git commit --allow-empty -m SPIKE-REFRESH-OK` 后，图谱在约 3 秒内出现新行，行数 1 → 2，验证文件监听与 refresh coordinator 联动。
- Shell 启动命令显式设置 PowerShell 的 Input/Output UTF-8 与 `TERM=xterm-256color`、`COLORTERM=truecolor`；移除 `ELECTRON_RUN_AS_NODE`。

### 5.3 自动化测试

```bash
cargo test -p git-graph-app   # 23 passed, 0 failed
cargo fmt --check             # 通过
npm run build                 # 通过（tsc --noEmit + Vite）
```

`terminal.rs` 单元测试覆盖：

- 配置了不存在的路径时拒绝启动，且不回退 PATH。
- 配置了存在的文件时使用该文件。
- 路径留空时回退 PATH 查找。

## 6. 可复现步骤

1. 在基线提交上构建并记录体积：

   ```bash
   git checkout 3400087
   npm ci
   npm run tauri build
   stat -c '%s %n' "src-tauri/target/release/bundle/msi/Git Graph_0.1.0_x64_en-US.msi" \
     "src-tauri/target/release/bundle/nsis/Git Graph_0.1.0_x64-setup.exe"
   ```

2. 切回 `spike/terminal`，构建探针：

   ```bash
   cd poc/terminal-backends
   cargo build --release --features portable --target-dir target-portable
   cargo build --release --no-default-features --features conpty --target-dir target-conpty
   ```

3. 按 5.1 的命令运行两个探针，比较 `EXIT` / `RESIZE` / `KILL` / `HAS_ESC` / `HAS_CJK`。

4. 构建 Spike 安装包并记录体积与 SHA256：

   ```bash
   cd ../..
   npm run tauri build
   stat -c '%s %n' "src-tauri/target/release/bundle/msi/Git Graph_0.1.0_x64_en-US.msi" \
     "src-tauri/target/release/bundle/nsis/Git Graph_0.1.0_x64-setup.exe"
   sha256sum src-tauri/target/release/bundle/msi/*.msi \
     src-tauri/target/release/bundle/nsis/*-setup.exe
   ```

5. 启动 release 并用 CDP 操作：

   ```bash
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
     ./src-tauri/target/release/git-graph-app.exe "C:/path/to/repo"
   ```

   在界面中打开“终端”，分别启动 Shell 与 LazyGit，验证中文输出、resize、退出码、仓库刷新和无孤儿进程。

6. 仓库刷新复现：在临时仓库启动应用，终端内空提交后观察图谱行数变化。

## 7. 风险与未验证项

1. **中文输入法未做 OS 级实机验证**：xterm.js 具备 composition 支持，但候选窗定位、全角标点、组合取消需在阶段 B 用真实输入法人工验证。
2. **ConPTY 退出语义特殊**：进程退出后 reader 不保证立即 EOF，必须独立轮询 `try_wait()`；当前实现已用 waiter 线程处理，后续修改终端生命周期时不可退回“等 reader EOF”。
3. **Shell 仅提供 PowerShell**：启动时注入 UTF-8 控制台设置；未提供 cmd / pwsh 选择，也未验证其他 shell 的编码行为。
4. **收起行为需在阶段 B 调整**：Spike 面板“收起”会结束进程；产品要求“关闭面板与结束进程是不同动作”，阶段 B 分离二者。
5. **LazyGit 路径尚无设置 UI**：配置字段与后端解析已具备，阶段 B 补设置界面与缺失指引实机验证。
6. **缺失 LazyGit 的 UI 指引未在无 LazyGit 环境实机复验**：本轮通过能力探测与单元测试覆盖；阶段 B 用无效路径/空 PATH 场景复验。
7. **前端主 chunk 增大**：xterm 进入主 chunk（约 +342 kB，未压缩），后续可评估按需加载；当前安装包增量仍远低于门槛。
8. **未签名**：与既有发布风险相同，正式分发需代码签名。
9. **权限边界**：终端与当前用户 Shell 同权，界面已明确提示；未做沙箱或命令白名单。
10. **未穷举验证**：拖放路径、剪贴板粘贴、Alt 组合键、窗口失焦后的按键行为仍需阶段 B 覆盖。

## 8. go/no-go

**go。** 阶段 A 完成标准逐项满足：

| 完成标准 | 结果 |
|---|---|
| 至少两种 Windows PTY 方案对比 | portable-pty vs conpty，含探针实测 |
| 版本/许可来源 | 第 3 节，均可追溯 |
| 中文/Unicode/ANSI/resize/退出回收 | 探针与 release 实测通过；IME 待阶段 B 人工验证 |
| 基线 MSI/NSIS 与差值 | +152 KiB / +136 KiB，满足 10 MiB 门槛 |
| LazyGit 外部程序验证 | 启动、退出、仓库刷新通过；自定义路径由单元测试覆盖 |
| 不捆绑 LazyGit | 未下载、未打包 |
| 可复现步骤 | 第 6 节 |
| 风险与结论 | 第 7、8 节 |

进入阶段 B：面板语义完善、LazyGit 路径设置、IME/焦点/快捷键验证、进程与仓库切换处理、文档更新。
