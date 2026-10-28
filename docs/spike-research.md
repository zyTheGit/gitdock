# Git Graph 技术选型 Spike 调研

> 日期：2026-10-28  
> 结论状态：建议进入 POC 验证，尚未终审

## 结论摘要

建议以 **Tauri 2 + React + Rust + gix（只读）+ Git CLI（写操作）** 作为 MVP 的首选验证组合。

- Tauri 2 能以 command / Channel 在 Rust 与 WebView 前端间通讯，并具备命令权限控制；适合将 Git 访问限制在 Rust 层。[Tauri command 文档](https://v2.tauri.app/develop/calling-rust/)
- Windows 上 Tauri 使用 WebView2，符合本项目 Windows 优先的桌面 Web UI 需求；macOS 和 Linux 则分别使用 WKWebView、webkit2gtk，因此跨平台渲染细节仍应单独验收。[Tauri WebView 版本说明](https://v2.tauri.app/reference/webview-versions/)
- gix 顶层 crate 提供 `sha256` feature，且 `ObjectId` 可表示 20 字节 SHA-1 或 32 字节 SHA-256 OID；它是“支持 SHA-256”需求下更稳妥的只读层候选。[gix crate 文档](https://docs.rs/gix/latest/gix/)、[gix-hash ObjectId 文档](https://docs.rs/gix-hash/latest/gix_hash/enum.ObjectId.html)
- git2-rs 当前已有 SHA-256 OID API，但依赖的 libgit2 将 SHA-256 支持描述为 experimental，并要求构建选项；若选择 git2，必须把 SHA-256 仓库作为阻断型 POC，而非默认承诺。[git2::Oid 文档](https://docs.rs/git2/latest/git2/struct.Oid.html)、[libgit2 变更记录](https://github.com/libgit2/libgit2/blob/main/docs/changelog.md)
- 需求中的写操作继续交给 Git CLI 是正确边界。官方文档确认 cherry-pick 冲突时会设置 `CHERRY_PICK_HEAD`，可作为状态机的可靠输入；不要依赖 stderr 文本判断冲突。[git-cherry-pick](https://git-scm.com/docs/git-cherry-pick)

## 候选方案比较

| 维度 | Tauri 2 + React | egui |
|---|---|---|
| 图谱 / diff 的富文本与虚拟列表 | 可直接复用成熟 Web UI 生态；需实测 IPC 传输量 | Rust 原生绘制，数据路径短；需自行承担更多编辑器与高亮能力 |
| Windows 运行时 | 基于 WebView2；Windows 11 默认具备，旧系统安装器可处理运行时 | 原生窗口，不依赖 WebView |
| 安全边界 | Tauri command 默认不向前端开放，需显式注册权限 | 无 WebView IPC，但仍需自行设计应用 API 边界 |
| 本项目建议 | **首选 POC**：前端负责虚拟渲染，Rust 返回分页 DTO | 仅在 Tauri 的大列表或 diff POC 未达到预算时作为备选 |

Tauri 的官方 command API 支持 async handler 与序列化参数/返回值；Channel 适合进度等持续事件。它不意味着可以把完整 DAG 或大 diff 一次性传入前端：MVP 应保持 Rust 分页，前端仅获取可视窗口和详情按需数据。[Tauri command 与 Channel 文档](https://v2.tauri.app/develop/calling-rust/)

| 只读 Git 层 | SHA-256 | 判断 |
|---|---|---|
| gix | 顶层 feature 明确提供 `sha256`；`ObjectId` 支持 SHA-1 / SHA-256 | **首选 POC** |
| git2-rs / libgit2 | OID API 支持格式参数；libgit2 的 SHA-256 仍标为 experimental，历史说明包含不适合生产发布的限制 | 备选；SHA-256 POC 失败即不选 |

## 已确认的 Git CLI 语义

- `git status --porcelain=v2` 是面向脚本的稳定格式，且能在加 `--branch` 时输出 `branch.oid`、`branch.head` 和 ahead/behind header；适合作为写前 Gate 与 UI 状态的数据源。[git-status](https://git-scm.com/docs/git-status)
- `git switch` 默认会尝试猜测远程跟踪分支；本需求只允许切换已有本地分支，因此实现必须先解析、验证本地 `refs/heads/*`，再调用 `git switch --no-guess <branch>`，避免意外创建分支或隐式跟踪远程分支。[git-switch](https://git-scm.com/docs/git-switch)
- `git switch` 默认会拒绝切换到已被其他 worktree checkout 的分支；MVP 不得使用 `--ignore-other-worktrees` 覆盖该保护。[git-switch](https://git-scm.com/docs/git-switch)
- cherry-pick 遇冲突时，官方说明会写入 `CHERRY_PICK_HEAD`，并在 index / worktree 中留下冲突状态；进程非零退出后应重新探测该状态而不是解析输出文本。[git-cherry-pick](https://git-scm.com/docs/git-cherry-pick)

## 必做 POC

### S1：图谱数据与布局

输入：用 `git fast-import` 生成 20 万 commit 的可复现仓库，覆盖分叉、合并、tag、远程跟踪分支与浅克隆。

验证：

- gix 按拓扑序读取前 200 条、继续分页和取消任务；
- 分页追加时既有 commit 的 lane 不变，跨页父边进入待连接状态；
- 记录首屏时间、每页时间、峰值内存与取消延迟。

通过门槛：以需求文档的 5 万 commit 首屏 ≤ 1.5 秒、10 万 commit 常驻内存 ≤ 500 MB 为初始预算；20 万 commit 结果用于评估余量，不先设硬性承诺。

### S2：Tauri IPC 与虚拟渲染

输入：S1 产生的分页 DTO、5,000 行与 50,000 行 diff fixture。

验证：

- Rust 命令只传首屏 200 条概要，详情和 diff 均按需获取；
- 滚动、筛选、取消与刷新 generation 变化时前端不显示过期数据；
- 测量 invoke 载荷大小、首帧、滚动帧时间与内存。

通过门槛：不把完整历史或完整大文件 diff 一次性序列化至 WebView；高亮和行渲染仅覆盖可视区。

### S3：对象格式兼容性

输入：各一个 SHA-1、SHA-256、shallow、bare 与 linked-worktree 仓库。

验证：

- gix 能打开仓库、枚举 refs、读取 commit、解析 annotated tag，并以正确长度显示 OID；
- 对同一 fixture 验证 git2-rs 行为，记录其 libgit2 构建 feature / 版本；
- 通过 Git CLI 校验 `rev-parse`、`merge-base`、`diff` 和 `rev-list --left-right --count` 的输出。

通过门槛：若 gix 不能稳定完成 SHA-256 的只读路径，则在架构终审中将 MVP 范围收紧为显式拒绝 SHA-256，而不是保留模糊承诺。

### S4：CLI 写操作与恢复

输入：正常、untracked、hook 拒绝、空 pick、冲突、已有中断态和另一个 worktree 占用目标分支的 fixture。

验证：

- `status --porcelain=v2`、`rev-parse --git-path`、中断态与 `index.lock` 检测；
- `cherry-pick` / `revert` 非零退出后，按操作态分为冲突与普通失败；
- `switch --no-guess` 不创建分支、不越过 worktree 保护；
- Windows 上验证无编辑器方式，避免假设 `GIT_EDITOR=true` 可执行。

通过门槛：任一失败分支均不误报成功或冲突，不执行自动 `--abort` / `--quit`，且重启后能恢复只读提示。

## 建议的终审准入条件

仅当以下条件满足，才冻结架构并开始 MVP：

1. S1 达到性能预算，且布局 lane 的跨页稳定性有自动化断言；
2. S2 证明 Tauri 前端在分页与大 diff 降级下无明显卡顿；
3. S3 确认 gix 的 SHA-256 只读链路；否则同步收紧需求与启动检测；
4. S4 覆盖写前 Gate、冲突、中断恢复和 linked worktree；
5. 明确分发平台、最低 Git 版本、Tauri 打包策略与日志目录。

## 建议的首个开发切片

通过 Spike 后，第一个可交付切片应是“打开仓库 → 读取当前分支可达的首 200 个 commit → 稳定图谱列表 → commit 详情”。不要在该切片混入 checkout、外部 diff 或写操作；这能最早验证数据 DTO、布局边界和 UI 性能。
