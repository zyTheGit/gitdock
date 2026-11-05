# ADR 0022：分支远程删除

- 状态：已接受（2026-11-05 实现于 `feature/branch-remote-delete`）
- 日期：2026-11-05
- 影响范围：`git-core/dto.rs`（WriteKind）、`git-write`（gate.rs / remote/gate.rs / command.rs / execute.rs）、`src/shared/types.ts`、`src/features/repository/branchMenus.ts`、`DeleteRefDialog.tsx`、i18n（repository/errors）
- 触发依据：用户需求「新增一个删除本地和远程分支的按钮」「删除改成 删除分支 或删除tag」

## 1. 背景

ADR-0008 的删除只使用安全形态 `git branch -d`，明确不提供远程删除；ADR-0008 §2.6 的确认框也只覆盖本地。用户要求支持删除本地和远程分支，入口为分支右键菜单的专门按钮；同时把菜单项文案从笼统的「删除」改为「删除分支」「删除标签」。

## 2. 决策

1. **契约**：`WriteKind` 新增 `delete_branch_remote`（snake_case），请求复用 `branch` 字段承载分支名；不新增 `delete_tag` 的远程变体（标签远程删除留作后续候选）。
2. **两段式执行**：前端先发 `delete_branch`（本地 `-d` 保护仍在），成功后再发 `delete_branch_remote`（`git push origin --delete <branch>`）。执行层保持「单请求单命令」模型（`execute.rs`），不做多命令串行；每条命令的失败语义独立，且复用既有 `remote_failure` 分类（认证失败/远端拒绝）。
3. **Gate**（`remote/gate.rs::validate_delete_branch_remote`）：`remote_count > 0`，且本地缓存存在 `refs/remotes/origin/<branch>`；**不要求 upstream**（`push --delete` 不需要）；本地缓存过期由执行阶段 Git 报错兜底（`remote_failure` 新增「远程分支不存在或已删除」分类）。
4. **交互**：`branchMenuItems` 新增「删除本地和远程分支」，仅当本地缓存存在远程跟踪引用（`refs.rs` 的 `classify_ref` 对 remote 分支保留 `origin/` 前缀）时可用；确认框标题/警告与仅本地删除分开；远程失败时提示「本地已删除，远程删除失败：<stderr>」并保留对话框，可关闭后重试。
5. **边界保持**：不提供 `git branch -D` 强制删除、不提供 force push；本地 `-d` 保护不因远程删除放松。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| `CommandSpec` 扩展为单请求串行两条命令 | 改动 execute 状态机与失败语义（需要"部分成功"状态），风险高 |
| `delete_branch` 加 `remote` 参数并在同请求内串行 | 同上 |
| 标签远程删除一并实现 | 本次范围聚焦分支；标签留作后续候选 |

## 4. 后果

- `WriteKind` 契约扩一个变体，`types.ts` 同步；命令日志会记录 `push --delete` 命令。
- 两段式执行最终成功消息取远程删除结果；本地删除消息在中间失败时用于说明状态。
- 远程删除失败时本地分支已不存在，文案已明确该状态。
- 侧栏不再出现笼统的「删除」文案；菜单项分别为「删除分支」「删除本地和远程分支」（分支）与「删除标签」（标签）。

## 5. 验收

1. 存在远程跟踪引用的分支：右键 →「删除本地和远程分支」→ 确认 → 本地与远程分支均消失。
2. 无远程跟踪引用的分支：该项禁用。
3. 远程删除失败（无权限/网络）：提示保留对话框，本地分支已删除的文案可见。
4. 本地未合并的分支：第一段被 Git 拒绝，远程不删除。
5. `npm run check` 全绿；实机验收按 GUI 验收清单 2.8。