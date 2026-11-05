# ADR 0011：merge / rebase / 批量 pick 与完整 pull

- 状态：已接受（2026-11-04 实现；PR #13 已合并；批量 pick 前端入口与 sequencer 应用内继续/中止已补齐；GUI 实机验收待用户）
- 日期：2026-11-04
- 影响范围：`crates/git-core/src/dto.rs`（WriteKind / PullMode / WriteRequest）、新增 `crates/git-write/src/history.rs` 与 `history/gate.rs`/测试、`command.rs`、`execute.rs`、`gate.rs`、`src/app/useWriteFlow.ts`、`useRemoteActions.tsx`、`GraphPane`、分支右键菜单、`ConfirmWriteDialog`、i18n
- 触发依据：docs/11 批次 5；docs/08 G6 完成标准；ADR-0001 / ADR-0002 的冲突与中断边界

## 1. 背景

批次 4 只提供 `pull --ff-only`，merge/rebase 与多提交 pick 仍依赖终端。批次 5 需要把本地历史整合纳入白名单，并复用既有冲突展示与继续/中止流程，不新增自动 `--abort` / `--skip`。

## 2. 决策

### 2.1 白名单与命令

`WriteKind` 新增 `Merge`、`Rebase`；`PullMode` 为 `ff_only` / `merge` / `rebase`。

- Merge：`git merge --no-edit <branch>`
- Rebase：`git rebase <branch>`
- Pull：`--ff-only` / `--no-rebase --no-edit` / `--rebase`
- 批量 pick：`request.oids` 非空时执行 `git cherry-pick <oid...>` 或 `git revert --no-edit <oid...>`；否则回退单 `oid`

不提供 interactive rebase、force push、`--autosquash`、按路径 merge；这些仍需终端。

### 2.2 Gate

| 操作 | 规则 |
|---|---|
| Merge / Rebase | 当前在本地分支且 unborn/detached 拒绝；目标本地分支存在；目标不能是当前分支；工作区/索引完全干净 |
| Pull | 保留批次 4 的 upstream 检查；非 ff-only 模式同样要求干净工作区 |
| 批量 pick | 首个 OID 必须是有效提交；merge commit 仍要求 mainline；工作区干净 |

中断态仍由通用前置拒绝；继续/中止是唯一入口。

### 2.3 中断与冲突

- 新增 continue/abort 支持：`Merge`（`MERGE_HEAD`）、`Rebase`（`REBASE_HEAD` / `rebase-merge` / `rebase-apply`）。
- 批量 cherry-pick / revert 使用 sequencer；继续/中止仍以 `CHERRY_PICK_HEAD` / `REVERT_HEAD` 判定当前步。
- 非零退出且存在对应标记 + conflicted index → `Conflicted`，复用既有冲突文件展示；本应用不自动 abort/skip。
- Rebase 属历史改写：确认框明确 `git rebase --abort` 恢复路径。
- 不把「退出码 0 但标记仍在」误判为成功。

### 2.4 UI

- 分支右键菜单新增「合并到当前分支…」「Rebase 当前分支到此分支…」。
- 确认框复用 `ConfirmWriteDialog`，展示 Gate 摘要、目标分支与恢复提示。
- Pull 模式在 GraphPane 同步按钮旁用紧凑下拉选择「仅快进 / 合并」；`--rebase` 由显式 rebase 操作承担。
- 继续/中止横幅支持 merge/rebase；批量序列复用 cherry-pick/revert 的中断类型。
- 写后刷新走既有 `onMutated` + generation 通道。

### 2.5 失败与恢复

- merge/rebase 冲突：保留中断标记，进入 Conflicted，用户解决冲突后点继续或中止。
- rebase 失败/冲突：`--abort` 恢复；不做自动 reset。
- 批量 pick 中途冲突：已完成的提交保留，当前步标记存在；继续或中止由用户决定。
- pull merge 冲突：进入 Conflicted；`pull --ff-only` 仍保持批次 4 的非快进行为提示。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 自动 rebase --continue / --abort | 会丢失用户手工解决结果，违反现有中断语义 |
| interactive rebase | 需要完整 sequence editor UI，风险与复杂度高 |
| merge/rebase 允许脏工作区 | Git 会拒绝或产生不可预期状态；首版要求干净 |
| pull 默认 rebase | 历史改写必须显式确认；默认保持 ff-only |

## 4. 后果

- `WriteKind` 22→24；新增 history Gate 模块、批量 pick 契约与 pull 模式。
- merge/rebase 冲突仍由既有冲突流承接；无需新增自动收尾逻辑。
- 完整 pull 仍受 upstream/干净工作区约束；force push 不在范围。

## 5. 验收清单

1. 非快进 merge 生成 2 父合并提交；冲突时 `Conflicted` 且 `MERGE_HEAD` 存在。
2. rebase 后当前分支提交重放到目标分支之上；`HEAD~1` 为目标分支 HEAD。
3. merge/rebase Gate 拒绝自身、脏工作区、detached/unborn、目标不存在。
4. 批量 cherry-pick 两个提交成功；顺序与 `git log` 一致。
5. pull ff-only 非快进继续提示；pull merge 成功/冲突路径符合预期。
6. 冲突后继续/中止：标记消失才算成功；不自动 skip/abort。
7. `npm run check` 全绿；文件行数合规。