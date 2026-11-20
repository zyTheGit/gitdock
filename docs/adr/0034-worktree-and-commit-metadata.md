# ADR-0034：Worktree 管理面板与提交模板 / 签名展示

- 状态：已接受（T12C）
- 日期：2026-11-20
- 相关：ADR-0004（Git 配置读写）、ADR-0008（分支与标签）、ADR-0028（远程同步）、ADR-0032（多仓库标签页）、`docs/03-技术架构.md`

## 背景

`git worktree` 已成为并行开发与 AI 编码的常用工作流，但 GitDock 只能打开一个工作目录，用户无法在应用内查看、创建或清理 linked worktree。同时两处提交元数据体验缺失：仓库配置了 `commit.template` 时新建提交不会预填；提交详情无法区分带 GPG/SSH 签名与未签名的提交。

## 决策

### 1. Worktree 只读列表

- **归属 `git-write`**：`git worktree list --porcelain` 是子进程，按架构边界不能放进坚持纯 gix 的 `git-read`；与 `staging_status` 一样作为 `GitWriteModule` 的只读查询，不经过 Gate、不持有写锁。
- 新模块 `crates/git-write/src/worktree.rs`：`list_worktrees()` 解析 porcelain 输出。
- DTO（`git-core/src/dto/` 新增 `worktree.rs`）：

```text
WorktreeDto {
    path: String,            // 绝对路径
    head_oid: Option<Oid>,   // 无提交时缺失
    branch: Option<String>,  // refs/heads/ 去掉前缀；detached 时缺失
    detached: bool,
    bare: bool,
    is_main: bool,           // porcelain 第一条即主 worktree
    locked: bool,
    lock_reason: Option<String>,
    prunable: bool,
}
```

- 新 Tauri command `read_worktrees() -> Vec<WorktreeDto>`，放在 `commands/read.rs`，内部调用 `session.write.list_worktrees()`（与 `staging_status` 同一 seam 风格）。
- 列表只读；解析失败的单个条目跳过而不是整体报错，缺失字段按缺省处理。

### 2. Worktree 写操作（WriteKind 39 → 41）

| WriteKind | 命令 | Gate / 约束 |
|---|---|---|
| `create_worktree` | `git worktree add <path> <branch>` | 非 bare、非中断态；`branch` 必须存在且未被任何 worktree 检出（含主 worktree）；`path` 必须为绝对路径、不含 `..`、不在 `.git` 内、父目录存在、目标不存在或为空目录；不自动创建父目录 |
| `remove_worktree` | `git worktree remove <path>` | `path` 必须出现在 `list_worktrees()` 中且 `is_main == false`、`locked == false`；**绝不使用 `--force`**；目标工作区不干净时 Git 会拒绝，Gate 将其转成可读提示（`worktree_remove_dirty`），由用户自行处理或改用终端 |

- 请求字段：`create_worktree` 使用 `new_name` 之外的既有字段——`path`（目标绝对路径）+ `branch`（源分支）；`remove_worktree` 只使用 `path`。`WriteRequest.path` 的「仓库内相对路径」注释需补充「worktree 类操作为绝对路径」。
- 参数数组启动；路径必须经前端目录选择器获得，Rust 侧仍做独立校验（不信任前端）。
- 两条命令共用现有写互斥与 Gate；成功后请求刷新，工作区变化由监听兜底。

### 3. 提交模板预填

- 新 Tauri command `read_commit_template() -> Option<CommitTemplateDto>`（`commands/read.rs`，调用 `GitWriteModule::read_commit_template`）：

```text
CommitTemplateDto { path: String, content: String }
```

- 读取链路：`git config --get commit.template` → 相对路径按**仓库根**解析 → 文件必须可读、≤ 64 KiB、UTF-8（非法 UTF-8 按 lossy 读取并返回）；未配置、文件不存在或超限时返回 `None`，不报错。
- 前端在**提交消息为空**时预填（草稿已存在时不覆盖）；用户编辑后不因刷新重新覆盖；stash / amend 表单同样使用空消息判断。

### 4. 签名状态展示（只读，不验签）

- `CommitDetailDto` 新增 `signature_kind: Option<String>`（serde skip_if_none）：`"gpg" | "ssh" | "x509" | "unknown"`。
- 来源：纯 gix 读取 commit `extra_headers` 中的 `gpgsig`（含 `gpgsig-sha256`）。按签名体首行判断：`-----BEGIN PGP SIGNATURE-----` → gpg；`-----BEGIN SSH SIGNATURE-----` → ssh；`-----BEGIN SIGNED MESSAGE-----` / `-----BEGIN CERTIFICATE-----` → x509；其余 → unknown。
- **只展示「已签名」徽标与类型，不调用 `gpg`/`ssh-keygen` 验签**，不缓存签名内容，不把签名体传到前端。
- `CommitSummaryDto` 不加字段，避免图谱列表为每个提交解析头。

## 前端

- `RepositorySidebar` 增加 Worktree 分区（折叠、计数）；每行显示分支/短 OID、`main` / `locked` / `prunable` 徽标与路径；点击行：
  - T12A 落地后在该 worktree 路径上新开或激活标签页（`open_repository(path)`）；
  - 若 worktree 路径不可用，提示错误并保留列表。
- 新建 Worktree 对话框：源分支选择（复用分支列表）+ 目标目录（`@tauri-apps/plugin-dialog` 目录选择器）+ 路径预览；执行前 Gate 报告；成功后刷新列表并可一键打开。
- 移除：破坏性确认框展示路径与分支，说明「未提交改动不会被保留，Git 会拒绝移除不干净的 worktree」；不提供 force 开关。
- 提交详情头部显示签名徽标（已签名 · GPG / SSH / X.509，未签名不显示徽标）。
- 所有文案双语；新增样式放入 `src/styles/` 现有分区，单文件 ≤ 600 行。

## 安全与边界

- Worktree 目标路径来自用户选择，后端校验绝对路径与目录状态；前端不能传命令片段，后端不拼接 shell。
- `remove_worktree` 不接受 `--force`，不删除主 worktree；`prunable` 条目不在本 ADR 自动清理（`git worktree prune` 属破坏性维护，留待后续）。
- 签名标注只代表提交对象携带签名头，不代表验签通过；界面文案必须写「已签名」而非「验证通过」。
- 提交模板内容属于用户输入上下文，仅用于预填，不写入日志。

## 测试与验证

- Rust：porcelain 解析单元测试（主/链接、detached、locked、prunable、bare）；`create_worktree` / `remove_worktree` 的 Gate 用例（分支已检出、路径非空目录、目标为主 worktree、locked）；集成测试在临时仓库创建并移除 worktree；模板读取（未配置 / 相对路径 / 超限）；签名检测（伪造 gpgsig 头 → gpg/ssh/unknown）。
- 前端：`npm run build`；详情页签名徽标；空消息预填模板、已有草稿不覆盖。
- GUI（release exe + CDP）：列出 linked worktree、创建、打开、移除；含签名提交详情显示徽标。

## 不在范围内

- `worktree lock/unlock/move/repair/prune`、强制移除、worktree 级独立配置。
- 签名验签、签名创建、`commit.gpgsign` 开关。
- 主 worktree 的改名与迁移。
