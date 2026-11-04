# ADR 0008：分支与标签管理——安全删除与本地 refs 边界

- 状态：已接受（2026-11-04 实现并随 PR #9 / `634af4c` 合并）
- 日期：2026-11-04
- 影响范围：`crates/git-core/src/dto.rs`（WriteKind / WriteRequest）、`crates/git-write/src/command.rs`、`crates/git-write/src/execute.rs`、`crates/git-write/src/gate.rs`、新增 `crates/git-write/src/branch.rs` 与 `crates/git-write/src/tag.rs` 及其 gate 子模块、`src/shared/types.ts`、前端分支/标签入口与对话框、`src/i18n/locales/*`
- 触发依据：docs/11 批次 2（批次 1 提交与 amend 已完成）

## 1. 背景

批次 1 已补齐暂存区提交闭环，但用户仍无法在应用内创建、删除、重命名本地分支，也无法创建或删除本地标签；图谱节点右键菜单与仓库侧栏缺少对应入口。GitDock 的写操作必须继续走 `WriteKind` 白名单、Gate、互斥和参数数组执行，不得引入通用命令执行通道。

## 2. 决策

### 2.1 白名单与命令构造

`WriteKind` 新增 `CreateBranch`、`DeleteBranch`、`RenameBranch`、`CreateTag`、`DeleteTag`。命令构造：

- 创建分支：`git branch <name> [<start-point>]`，创建但不切换；未提供起点时使用当前 HEAD，detached HEAD 下同样合法。
- 删除分支：仅 `git branch -d <name>`（已合并安全形态）。
- 重命名分支：`git branch -m <old> <new>`。
- 创建轻量标签：`git tag <name> <target>`。
- 创建附注标签：`git tag -a --message=<文本> <name> <target>`。
- 删除标签：`git tag -d <name>`，只删除本地标签。

所有命令继续以参数数组启动、不经 shell；分支/标签名在 Gate 中通过 `git check-ref-format` 校验，并额外拒绝空值、首尾空白和以 `-` 开头的选项注入形态。

### 2.2 Gate 校验拆到独立模块

git-write 现有 `gate.rs` 已超过 500 行，继续堆叠会逼近 600 行硬上限；新增 `branch.rs`（含 `branch/gate.rs`）与 `tag.rs`（含 `tag/gate.rs`），`gate.rs` 只负责分发。校验规则：

| 操作 | 规则 | issue code |
|---|---|---|
| CreateBranch | 名称合法、目标不存在、起点为有效 commit；unborn HEAD 且无起点则拒绝 | gate_invalid_branch_name / gate_branch_exists / gate_branch_start_invalid / gate_unborn_head_branch |
| DeleteBranch | 分支存在、不是当前分支、未被其他 worktree 占用 | 复用 gate_branch_missing / gate_branch_checked_out，新增 gate_branch_current |
| RenameBranch | 旧分支存在、新名称合法且不冲突、新旧不同 | gate_branch_rename_same 等 |
| CreateTag | 名称合法、标签不存在、目标为有效 commit | gate_invalid_tag_name / gate_tag_exists / gate_tag_target_invalid / gate_unborn_head_tag |
| DeleteTag | 标签存在 | gate_tag_missing |

bare 仓库与存在未完成 Git 操作时的拒绝仍由 `gate.rs` 的通用前置逻辑统一处理。

### 2.3 删除只提供安全形态

首版不提供 `git branch -D`。删除未合并分支时 Git 会拒绝，应用展示 stderr 并提示用户到内置终端执行 `-D`。这样可以避免在 UI 中暴露不可逆的丢失提交操作，同时保留终端兜底路径。

### 2.4 契约与前端流

- `WriteRequest` 增 `new_name: Option<String>`，用于 `rename_branch`；其余操作忽略（git-core dto.rs 与 `src/shared/types.ts` 同步）。
- 侧栏分支列表新增「新建分支」入口；分支右键菜单新增「重命名」「删除」；图谱提交右键菜单新增「在此创建分支」「在此创建标签」。
- 新增 `CreateBranchDialog`、`RenameBranchDialog`、`CreateTagDialog`、`DeleteRefDialog`；创建类表单直执，删除与重命名展示专门确认块。
- 写后刷新复用既有 `readSnapshot` + `reload` + RefreshCoordinator generation 通道；不新增 IPC 命令。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 创建分支时自动切换（`git switch -c`） | 切换会改变工作区语义并可能携带未提交改动；创建与切换是两个意图，保持 `git branch` 的纯 refs 语义更安全 |
| 支持 `-D` 强制删除 | 属破坏性操作，没有产品确认；终端可完成 |
| 同时删除远程标签 | 涉及远程写与凭据策略，超出批次 2 边界 |
| 在 UI 层拼接 Git 命令 | 违反唯一扩展通道约束 |

## 4. 后果

- `WriteKind` 10→15；新增 Gate 校验模块与前端对话框，i18n 文案集中在 zh/en 资源，由 `check-i18n` 门禁覆盖。
- 分支与标签操作不触及工作区；删除当前分支、名称冲突、非法名称等由 Gate 在写前拦截。
- 未合并分支的强制删除不在应用内提供，需要终端操作。

## 5. 验收清单

1. 从当前 HEAD 创建分支：`refs/heads/<name>` 指向原 HEAD，当前分支不变。
2. 从指定 commit 创建分支：新 ref 指向该 commit。
3. 删除已合并分支成功；删除当前分支或未合并分支被拒绝且 ref 保留。
4. 重命名分支后旧 ref 消失、新 ref 指向原提交；重命名当前分支后 HEAD 跟随新名。
5. 轻量标签的 `cat-file -t` 为 commit，附注标签为 tag，且多行消息保真。
6. 删除本地标签后 `show-ref` 校验不存在；非法/重复名称被 Gate 拒绝。
7. `npm run check` 全绿；触及文件行数合规。