# T12：进阶协作与工作台能力（多仓库标签页 / 轻量冲突辅助 / Worktree 管理）

- **波次**：Wave 3（P1–P2 进阶能力）
- **优先级**：12A（P1）、12B（P1）、12C（P2）
- **前置依赖**：T01（强依赖，避免直接改动庞大的单仓 `App.tsx` 与 `state.rs`）
- **是否需要 ADR**：**是**（三个子任务**必须拆为 3 篇独立 ADR 与 3 个独立分支**逐一落地，严禁打包在一次提交里完成）

> **拆分说明**：以下 `12A`、`12B`、`12C` 彼此完全解耦，可分别分派给不同模型在不同阶段独立实施。

---

## 子任务 12A：多仓库标签页（Multi-Repo Tabs）

- **ADR**：`docs/adr/0032-multi-repo-tabs.md`
- **目标**：打破「单窗口单仓库」限制，支持同一窗口打开多个本地仓库标签页，切换标签页时保留各仓库的图谱范围、选中提交、对比槽位与 PTY 终端状态。
- **核心设计要点**：
  - **后端多会话化**（`src-tauri/src/app/state.rs`、`watch.rs`、`terminal.rs`）：
    - 将单 `RepoSession` 升级为 `HashMap<RepoId, RepoSession>` + `active_repo_id`（或所有读/写 command 保持兼容：缺省取当前活动仓库，或显式传 `repo_id`）；
    - 每个打开的仓库独立维护 `RefreshCoordinator` generation、写互斥锁（跨仓可并行、同仓仍互斥）、文件监听与可选的独立终端会话；
    - 关闭标签页时准确回收该仓库的 watcher 与 PTY 进程（避免泄露）。
  - **前端标签栏**（新建 `src/app/RepoTabBar.tsx` + `useRepoTabs.ts`）：
    - 顶部展示已打开仓库标签（显示仓库名 + 脏状态圆点 + 关闭按钮 + `+` 打开新仓库）；
    - 切换标签保留各标签的 UI 视图态（`scope`、`selectedOid`、`compareSlots`、`mode`）；
    - 启动时可选恢复上次打开的标签页列表（沿用 `restore_last_repository` 语义）。
- **验收标准**：同时打开 2 个以上仓库，在仓库 A 启动终端并在仓库 B 浏览对比视图，切回仓库 A 时终端仍在运行、图谱滚动与对比槽位完好无损；关闭仓库 A 标签页后对应 PTY 与 watcher 彻底释放。

---

## 子任务 12B：轻量级冲突解决辅助

- **ADR**：`docs/adr/0033-lightweight-conflict-assist.md`
- **目标**：在暂存区冲突文件区（`StagingView.tsx` 冲突分组）补齐轻量解决动作，覆盖 80% 简单冲突而无需离开界面，同时坚持「绝不自动 continue / abort」原则。
- **核心设计要点**：
  - **新增白名单 `WriteKind`**（`git-core` + `git-write/src/conflict/`）：
    - `ResolveConflictOurs`：`git checkout --ours -- <path>` 后可选配合显式 `MarkConflictResolved`
    - `ResolveConflictTheirs`：`git checkout --theirs -- <path>`
    - `MarkConflictResolved`：`git add -- <path>`（Gate 严格校验该路径当前确实处于 conflicted 状态；可选检测文件内是否仍残留 `<<<<<<<` / `=======` / `>>>>>>>` 冲突标记，若残留则返回 warning 要求用户二次确认）
  - **外部合并工具入口**（可选）：在设置「对比工具」中允许配置合并模板（如 `$LOCAL $REMOTE $BASE $MERGED`），或复用现有工具打开冲突文件。
  - **前端 UI**：在 `StagingView` 冲突文件每行右侧增加「采用当前（Ours）」「采用传入（Theirs）」「标记已解决」按钮；Ours/Theirs 属覆写操作，点击弹出清晰确认框说明哪一侧会保留；所有冲突解决后顶部既有横幅的「继续」按钮自然可用，由用户手动点击确认完成。
- **验收标准**：在真实 merge / cherry-pick / rebase 冲突夹具中，可通过界面分别选择 Ours/Theirs 并标记已解决，随后点击横幅「继续」顺利完成操作；若文件仍残留冲突标记，标记已解决时触发明确提示。

---

## 子任务 12C：Worktree 管理面板与提交模板 / 签名展示

- **ADR**：`docs/adr/0034-worktree-and-commit-metadata.md`
- **目标**：适配多分支并行开发与 AI 编码高频使用 `git worktree` 的工作流，同时完善提交元数据体验。
- **核心设计要点**：
  1. **Worktree 只读列表与基础管理**：
     - 后端读取 `git worktree list --porcelain`（落在 `git-write` 只读查询或独立受限读取，遵循 `git-read` 不启子进程原则），返回各 worktree 路径、HEAD 分支/OID、是否主 worktree、是否 locked/prunable；
     - 白名单写操作：`CreateWorktree`（`git worktree add <path> <branch>`，路径须经用户文件选择器选择且目录为空/不存在）、`RemoveWorktree`（`git worktree remove <path>`，非 `--force`，破坏性确认）；
     - 侧栏展示 Worktree 列表，点击一键切换当前窗口（或在新标签页，若 12A 已落地）打开该 worktree。
  2. **提交模板与签名状态（轻量附加）**：
     - 读取当前仓库配置的 `commit.template`（若存在且文件可读且 ≤ 64 KiB），在新建提交表单初始化时自动预填；
     - 在提交详情（`CommitDetailPane`）展示提交对象是否携带 GPG/SSH 签名头（纯 `gix` 读取 commit `extra_headers` 中的 `gpgsig`，无需调外部 `gpg` 验签，只展示「已签名 / 未签名」标注，保持只读安全与性能）。
- **验收标准**：在包含 linked worktree 的仓库中可列出全部 worktree 并快速切换打开、安全创建与移除干净的 worktree；配置了 `commit.template` 的仓库打开暂存区提交框自动加载模板；含签名提交在详情页显示签名徽标。
