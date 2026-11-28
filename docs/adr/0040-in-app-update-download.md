# ADR 0040：应用内更新安装包下载与 SHA-256 校验（方案 A）

- 状态：已接受（2026-11-28）
- 日期：2026-11-28
- 影响范围：`src-tauri/Cargo.toml`、`src-tauri/src/app/update/`、`src-tauri/src/app/platform/installer.rs`、`src-tauri/src/app/state/mod.rs`、`src-tauri/src/app/commands/app.rs`、`src-tauri/src/lib.rs`、`src/shared/{types,ipc}.ts`、`src/app/{useUpdateDownload,AppShell,AppDialogs,App}.tsx`、`src/features/settings/{UpdateDownloadControls,UpdateDialog,AboutSection,SettingsDialog}.tsx`、`src/styles/dialogs.css`、i18n（settings / errors）

## 1. 背景

此前版本检查只调用 `https://api.github.com/repos/zyTheGit/gitdock/releases/latest` 比较语义化版本号，发现新版本后只能点击跳转到浏览器中的 Release 页面手动寻找并下载对应安装包。用户希望能够在程序内直接下载更新包并衔接安装。

## 2. 决策

采用 **方案 A：基于既有 `ureq` + `SHA256SUMS.txt` 的应用内流式下载与校验**，暂不引入官方 `tauri-plugin-updater`：

1. **为什么不选 `tauri-plugin-updater`**：
   - 本项目 CI（`.github/workflows/release.yml`）已发布 Windows NSIS（`*-setup.exe`）、macOS 未签名 DMG（`*_aarch64.dmg`）、Linux Debian 包（`*_amd64.deb`）与统一校验文件 `SHA256SUMS.txt`；
   - 官方 updater 不支持 `.deb` 原地替换（且项目已下线 AppImage），且 macOS 未签名/未公证二进制原地替换后容易被 Gatekeeper 拦截；
   - 方案 A 复用已有 `ureq` 与 workspace 内 `sha2`，不新增重型 HTTP/验签依赖树。
2. **资产匹配规则（仅当前平台+架构）**：
   - `windows` + `x86_64` → `*-setup.exe`
   - `macos` + `aarch64` → `*_aarch64.dmg`
   - `linux` + `x86_64` → `*_amd64.deb`
   - 必须同时存在同名校验入口 `SHA256SUMS.txt`；任一缺失时 `can_download = false`，前端降级为「打开下载页」。
3. **安全边界（Fail-Closed）**：
   - 前端**不能传任意下载 URL 或磁盘路径**，仅通过受限命令触发后端缓存的当前版本资产下载；
   - 初始资产 URL 与校验文件 URL 必须以 `https://github.com/zyTheGit/gitdock/releases/download/` 开头；
   - 禁用 `ureq` 自动跳转，手动跟随最多 5 跳重定向并强制 `https://` 且目标主机名仅允许 `github.com` 或 `*.githubusercontent.com`；
   - 流式下载限制单包上限 200 MiB、校验文件上限 64 KiB，边下边算 SHA-256 并写入 `.part` 临时文件，校验通过后才原子重命名为最终文件；任一步失败或取消均删除 `.part`。
4. **缓存目录与清理**：
   - 下载落盘到 `cache_dir/updates/<version>/<safe_filename>`；启动时清理残留 `.part` 文件以及版本 `<=` 当前版本的旧更新缓存，保留高于当前版本的已下载安装包以便重启后复用（复算 SHA-256 通过即免重复下载）。
5. **三平台安装衔接（收敛到 `platform::launch_installer`）**：
   - Windows：启动 NSIS 安装向导后在 300ms 后优雅关闭终端并退出应用释放 exe 文件锁；
   - macOS：调用 `open <xxx.dmg>` 挂载并打开镜像窗口，并保留「在访达中显示」；
   - Linux：调用 `platform::reveal` 在文件管理器中选中 `.deb`，前端展示可复制的 `sudo apt install ./<file>` 命令。
6. **新增 IPC 契约**：
   - `UpdateCheckDto` 扩展可选字段 `release_notes`、`asset_name`、`asset_size` 与布尔字段 `can_download`；
   - 新增命令：`download_update`、`cancel_update_download`、`install_downloaded_update`、`reveal_downloaded_update`；
   - 新增事件：`update-download-progress`（`{ version, phase, downloaded_bytes, total_bytes }`）。
