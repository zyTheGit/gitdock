# T09：本地回退（Git Reset）与只读 Reflog 恢复视图

- **波次**：Wave 2（P0 核心 Git 能力闭环）
- **优先级**：P0
- **前置依赖**：T01
- **是否需要 ADR**：**是**（新增破坏性/历史改写 `WriteKind::Reset` 与只读 `read_reflog` command + DTO，须新增 `docs/adr/0029-reset-and-reflog.md` 并同步 `docs/03-技术架构.md`）
- **可并行性**：与 T06/T07/T08 串行合并

---

## 1. 背景与目标

1. 开发中经常需要撤销本地最近 1–2 次尚未推送的提交（如拆提交、漏改文件、提交到了错误分支），当前只有 `revert`（产生新反向提交）和 `amend`（只能改 HEAD），缺少 `git reset --soft / --mixed / --hard`。
2. GitDock 全链路在 amend、rebase、delete 等多个危险确认框中反复提示用户「可通过 `git reflog` 恢复」，但应用内并没有查看 Reflog 并一键救回提交的入口。将 `Reset` 与只读 `Reflog` 恢复视图配套落地，可形成真正的安全闭环。

---

## 2. 范围（In Scope）与边界（Out of Scope）

### In Scope
1. **契约（`git-core` + `src/shared/types.ts`）**：
   - `WriteKind` 新增 `Reset`；新增 `ResetMode` 枚举：`Soft` / `Mixed` / `Hard`；`WriteRequest` 增 `reset_mode?: ResetMode`（serde 兼容旧请求）。
   - 新增只读 DTO：`ReflogEntryDto { index: u32, selector: String, old_oid: Option<Oid>, new_oid: Oid, message: String, created_at: i64 }`。
2. **后端 Reset（`git-write` 新建 `reset.rs` + `reset/gate.rs` + 测试）**：
   - 命令：`git reset --soft|--mixed|--hard <oid>`（参数数组）。
   - Gate 规则：
     - 拒绝 bare 仓库、中断态、unborn HEAD、目标 OID 非有效 commit；
     - 若目标就是当前 HEAD 且工作区/暂存区无对应改动，可给出明确提示；
     - `Hard` 模式若工作区存在未提交改动或未跟踪文件，Gate 返回显式 warning + `affected_paths`；
     - 若当前分支存在上游且重置将丢弃已推送到上游的提交，返回显式 warning 提示「回退已推送历史将导致与远端分叉」。
3. **后端只读 Reflog（`git-read` 新建 `read/reflog.rs` + Tauri command `read_reflog`）**：
   - 纯 `gix` 读取 `HEAD` 的 reflog（参考 `crates/git-read/src/read/stash.rs` 的实现方式），倒序返回最近 N 条（如默认 200 条），不启子进程、符合 `v2_readonly` 静态守卫。
4. **前端 UI**：
   - **提交右键菜单**（`src/features/graph/menus.ts`）：新增「重置当前分支到此提交…」，弹出 `ResetDialog`：
     - 单选三种模式并配清晰中文/英文说明：
       - **Soft（软重置）**：仅移动分支指针，保留暂存区与工作区改动；
       - **Mixed（混合重置，默认）**：移动分支指针并清空暂存区，保留工作区改动；
       - **Hard（硬重置，高危）**：移动分支指针并**永久销毁**暂存区与工作区所有已跟踪改动（需勾选额外确认或红色危险主按钮，强调未提交改动不可用 reflog 恢复，而已提交历史可用 Reflog 恢复）。
   - **Reflog 恢复入口**（如底部面板新标签页或顶栏/工具区弹窗 `ReflogDialog`，具体形态在 ADR-0029 定稿）：
     - 列出 `HEAD@{N}`、短哈希、操作消息、时间；
     - 支持点击复制 OID、右键「在此创建恢复分支…」（复用既有 `CreateBranchDialog`）或「Cherry-pick 此提交」。

### Out of Scope
- 不提供 `git reflog expire` / `git gc --prune` 等清理 reflog 的写操作。
- 不支持多选提交重置。

---

## 3. 涉及模块与文件落点

- 文档：
  - 新增 `docs/adr/0029-reset-and-reflog.md`
  - 更新 `docs/03-技术架构.md`
- Rust：
  - `crates/git-core/src/dto/{repo,write}.rs`
  - `crates/git-read/src/read/reflog.rs` + `read/mod.rs` + 集成测试
  - `crates/git-write/src/reset/`（`mod.rs`, `gate.rs`, `tests.rs`）+ `command.rs`, `gate.rs`, `execute.rs`
  - `src-tauri/src/app/commands/read.rs` & `src-tauri/src/lib.rs`（注册 `read_reflog`）
- 前端：
  - `src/shared/types.ts`、`src/shared/ipc.ts`
  - 新建 `src/features/write/ResetDialog.tsx`、`src/features/graph/ReflogDialog.tsx`（均 ≤ 280 行）
  - `src/features/graph/menus.ts`、`src/app/useCommitMenus.ts`、`src/App.tsx`（或装配层）
  - `src/i18n/locales/{zh-CN,en}/{graph,write,errors}.ts`

---

## 4. 验收标准

- **Given** 当前分支有 2 个本地提交，**When** 对前一个提交执行 `reset --soft`，**Then** 分支指针回退，原提交改动保留在暂存区。
- **Given** 对前一个提交执行 `reset --mixed`，**When** 确认执行，**Then** 分支指针回退，改动保留在未暂存工作区。
- **Given** 选择 `reset --hard`，**When** 弹出确认框，**Then** 必须清晰展示受影响改动警告并经强破坏性确认后才执行；执行后未提交的已跟踪改动被清除。
- **Given** 刚刚执行过 `reset` 或 `amend`，**When** 打开 Reflog 视图，**Then** 能看到被替换前的旧提交记录，且可一键「在此创建分支…」将旧提交完整找回。
- **Given** 执行 `npm run check`，**When** 校验结束，**Then** IPC 契约、i18n、`v2_readonly` 静态守卫及全量测试全部通过，所有触及文件 ≤ 600 行。
