# Release 打包验证（Windows x64）

> 注：本文记录 2026-10-28 的验证结果，文中 `git-graph-app.exe` / `Git Graph_*` 为更名前的可执行文件与安装包名；2026-11-02 起分别为 `gitdock-app.exe` / `GitDock_*`。

- 日期：2026-10-28
- 结论：MSI / NSIS 均构建成功，release exe 冒烟通过；**未签名**（无证书，见第 5 节）
- 构建命令：`npm run tauri build`

## 1. 产物

| 产物 | 大小 | SHA-256 |
|---|---|---|
| `target/release/git-graph-app.exe` | 14.0 MiB | `44AFC6E3248F1423F0A0C09331E7874E0F1498AA69B4570215A1034F6F4D7D88` |
| `target/release/bundle/msi/Git Graph_0.1.0_x64_en-US.msi` | 5.73 MiB | `D4E07F4E8270473A5AD36B301A25F29F1081C9A4E56F46B12F566A709736AD43` |
| `target/release/bundle/nsis/Git Graph_0.1.0_x64-setup.exe` | 4.33 MiB | `6EFDE7E9FF54B4EF3F48A9D09564A6BA7DB0B0E7B3E16F85B4774EEF968CFF51` |

- 环境：Rust 1.99.1 release、Tauri 2.12.5、NSIS 3.13、WiX 3.14（首次构建自动下载）。
- 产物不提交仓库；以上哈希仅对应当前工作区构建。

## 2. 冒烟验证

以启动参数直接打开 `target/test-fixtures/linear`：

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
  ./target/release/git-graph-app.exe "C:/zy/project_other/ai-projects/git-graph/target/test-fixtures/linear"
```

验证项：

| 项 | 结果 |
|---|---|
| 应用启动并打开指定仓库 | 通过（日志「启动」与「打开仓库」同一秒，监听启动 +1 s） |
| IPC `repository_state` | 返回 `linear`、分支 `main`，约 0.2 s（含 CDP 往返） |
| 主界面渲染 | 显示「工作区干净」、最近仓库与图谱区域 |
| 生产 CSP 与 IPC | 无 `IPC custom protocol failed` 告警，自定义协议路径可用 |
| 安装器 | 仅校验构建与签名状态；未在本机执行安装，避免改动系统 |

## 3. 本轮发现并修复的问题

### 3.1 生产 CSP 未允许 IPC 连接

`tauri.conf.json` 的 `csp` 缺少 `connect-src 'self' ipc: http://ipc.localhost`，release 下每次 IPC 先报 `Failed to fetch` 再回退 postMessage。已补上该指令。

### 3.2 GUI 进程启动 git 每次阻塞约 3 s

release exe 无控制台，直接 `Command::new("git")` 会让 Windows 默认终端接管子进程控制台，单次耗时约 3.1 s：

- `app_info`（`git --version`）、`GitReadModule::open`、`inspect_interruption`（一次 `rev-parse --absolute-git-dir` 定位后逐标记检查文件；早期版本为每个标记一次 `rev-parse --git-path`）、监听器（两次 `rev-parse`）叠加后，**冷启动打开仓库延迟约 30 s**。
- 最小复现：GUI 子系统程序中无标志 spawn `git --version` ≈ 3110 ms；加 `CREATE_NO_WINDOW` 后 ≈ 28 ms。
- 修复：`git-read` 的版本探测、`git-write` 的 `execute` / `run`、`watch.rs` 的 `rev-parse` 统一使用 `creation_flags(0x0800_0000)`。
- 修复后实测：启动到打开仓库 < 1 s（日志同秒），监听启动 +1 s。

## 4. 复现与检查命令

```bash
npm run tauri build
powershell -NoProfile -Command "Get-AuthenticodeSignature 'target/release/git-graph-app.exe'"
powershell -NoProfile -Command "Get-FileHash -Algorithm SHA256 -Path 'target/release/bundle/msi/Git Graph_0.1.0_x64_en-US.msi'"
```

## 5. 签名与分发

- 三个产物均为 `NotSigned`；未配置代码签名证书。
- 未签名分发的后果：SmartScreen 首次运行警告、企业环境可能被策略拦截。正式分发前需配置 Windows 代码签名证书并接入 CI。
- RPM / deb / AppImage / dmg 不在 Windows 目标内；本轮只验证 Windows x64。

## 6. 建议

1. 为 release 增加签名步骤与哈希清单（可在 CI 中生成）。
2. 在干净机器上执行一次 MSI / NSIS 安装、升级、卸载验证。
3. 将「启动到首屏」的端到端耗时纳入 release 冒烟脚本（当前仅人工记录）。
