# ADR 0002：暂存区与 dirty 分支切换策略

- 状态：已接受（2026-10-30 裁决：方案 A + 普通二次确认）
- 日期：2026-10-30
- 影响范围：`git-core` 暂存 DTO、`git-write` 暂存写白名单与 Gate、分支切换 Gate、暂存区前端视图、`docs/01-需求冻结.md`、`docs/03-技术架构.md`、`docs/06-GitDock后续需求与执行计划.md`
- 触发依据：`docs/06` 阶段 C 要求先修订需求与 ADR，再实现依赖 dirty 分支切换策略的行为

## 1. 背景

MVP 的写前 Gate 对 cherry-pick、revert 和切换分支一律要求工作区干净（staged、tracked、untracked 均为 0），否则返回 `worktree_dirty` 拒绝。该规则在阶段 C 之前是合理的安全默认值，但与后续需求 N6 冲突：

- N6 要求：有暂存或未提交改动时不自动 stash、不丢弃数据；若 Git 能安全保留改动，可由用户显式确认后尝试切换；若目标分支会覆盖文件或 Git 拒绝，保留原状态并展示错误与建议。
- 阶段 C 同时新增暂存区：用户可以 staged/unstaged 文件，分支切换确认 UI 需要列出受影响文件并引导用户进入暂存区处理。

因此需要明确：**在 dirty/staged/untracked 存在时，应用是否允许发起切换**，以及允许时的判定来源、确认语义和失败处理。该问题只影响切换分支；cherry-pick / revert 仍保持“工作区必须干净”的既有 Gate 语义。

## 2. 决策

**方案 A：显式确认 + 由 Git 判定**；确认交互采用**普通二次确认**（不增加“我了解改动会保留在工作区”勾选项）。

- Gate 在 dirty/staged/untracked 存在时不直接拒绝，而是返回 `ok = true` 并附带：
  - `warnings`：说明改动数量、不会自动 stash/reset/clean、改动会被保留、覆盖时 Git 会拒绝；
  - `affected_paths`：受影响文件清单（最多 50 条），超出时用总数说明还有多少项。
- 确认框明确写出：不会自动 stash、reset、clean；切换可能把改动带到目标分支；若 Git 拒绝，改动保持原样；并列出受影响文件。
- 用户确认后执行 `git switch --no-guess <branch>`。成功则刷新；失败则保留原状态，展示 stderr 诊断与处理建议（提交、暂存或进入暂存区/终端）。
- 不新增 `--force`、`--discard-changes`、`-m` 等会丢弃或合并改动的选项。
- 中断态（merge/cherry-pick/revert/rebase/sequencer/index.lock）仍然一律拒绝切换；索引存在未解决冲突（`status.conflicted > 0`）时同样拒绝并列出冲突文件。
- detached HEAD、unborn HEAD、目标分支不存在、目标分支被其他 worktree 占用等既有拒绝规则不变。
- cherry-pick / revert 仍保持“工作区必须干净”的 Gate 语义，不随本决策改变。

### 备选方案（未采纳）

| 方案 | 行为 | 优点 | 代价 |
|---|---|---|---|
| A（采纳） | 显式确认后交给 `git switch` 判定 | 与 Git 真实行为一致；不重复实现覆盖判定；失败不丢数据 | 用户确认后才能知道 Git 是否接受；需清楚展示失败诊断 |
| B | 先跑只读 dry-run（如 `git read-tree -m -u -n HEAD <target>`）预检，通过才允许切换 | 能在执行前给出“可安全切换/会覆盖”的确定结论 | dry-run 与 `git switch` 并非完全等价（untracked、子模块、稀疏检出等边界），可能误判；实现与测试成本更高 |
| C | 继续保持所有 dirty/staged/untracked 一律拒绝 | 零风险；改动最少 | 不满足 N6“可安全保留时允许切换”，暂存区完成后体验割裂 |

### 分支切换验收

| 编号 | Given / When / Then |
|---|---|
| C-7 | Given 工作区有已暂存/未暂存/未跟踪改动 When 打开切换确认 Then Gate 通过并显示改动数量与受影响文件清单，且明确不自动 stash/reset/clean |
| C-8 | Given 有改动但目标分支不覆盖这些文件 When 确认切换 Then 切换成功，改动保留且 `git status` 与切换前一致 |
| C-9 | Given 有改动且目标分支会覆盖同一文件 When 确认切换 Then Git 拒绝，当前分支与改动原样保留，界面显示 stderr 诊断与处理建议 |
| C-10 | Given 存在未完成 merge/rebase/cherry-pick/revert/sequencer 或 index.lock When 尝试切换 Then Gate 拒绝，不执行任何写命令 |
| C-11 | Given 索引存在未解决冲突 When 尝试切换 Then Gate 拒绝并列出冲突文件 |

## 3. 暂存区部分（已确定，不依赖本 ADR）

以下行为按阶段 C 需求直接实现，不需要额外裁决：

- 以 `git status --porcelain=v2 -z` 为唯一状态来源，按 `HEAD → Index → Worktree` 分为 staged 与 unstaged 两组；未跟踪文件只出现在 unstaged 组；冲突文件单列并禁止 stage/unstage。
- 文件级 staged/unstaged diff 通过 Git CLI 生成（staged 用 `git diff --cached`，unstaged 用 `git diff`，未跟踪用 `git diff --no-index`）；对重命名同时传入旧路径与新路径。
- stage 使用 `git add -A --pathspec-from-file=- --pathspec-file-nul`；unstage 在已有 HEAD 时使用 `git restore --staged`，unborn HEAD 时使用 `git rm --cached`；均只接受当前状态列表中存在的路径。
- 暂存写操作沿用全局互斥、Gate、`WriteOutcomeDto` 状态机与写后刷新；失败不执行回滚，Git 自身保证不丢数据。
- 首期不做部分行暂存、交互式暂存、自动 stash。

## 4. 验收（暂存区）

| 编号 | Given / When / Then |
|---|---|
| C-1 | Given 文件同时有 staged 与 unstaged 改动 When 打开暂存区 Then 两组均显示该文件及各自 diff |
| C-2 | Given 未跟踪文件 When 暂存 Then 文件进入 staged 组；取消暂存后回到 unstaged 组且内容不变 |
| C-3 | Given 重命名已暂存 When 查看 staged diff Then 同时传入旧/新路径，显示 rename 而非新增 |
| C-4 | Given 批量选择多个文件 When 暂存/取消暂存 Then 一次命令完成，状态与 `git status` 一致 |
| C-5 | Given 冲突文件 When 查看暂存区 Then 单列展示并禁止应用内 stage/unstage |
| C-6 | Given 暂存操作失败 When 查看结果 Then 保留原改动并显示可理解的 stderr 诊断 |

## 5. 裁决记录

2026-10-30 产品负责人裁决：

1. dirty/staged/untracked 存在时，切换分支采用 **A（显式确认 + Git 判定）**。
2. 确认框使用**普通二次确认**，不增加额外勾选项。
3. 方案 B 不采纳，其 untracked 预检问题不再适用。

本文件状态改为「已接受」，分支切换部分按第 2 节实现；暂存区部分不受影响。
