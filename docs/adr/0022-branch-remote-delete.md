# ADR 0022：分支远程删除

- 状态：已接受（2026-11-05 实现于 `feature/branch-remote-delete`；2026-11-13 增补标签远程删除，见 §7）
- 日期：2026-11-05
- 影响范围：`git-core/dto.rs`（WriteKind）、`git-write`（gate.rs / remote/gate.rs / command.rs / execute.rs）、`src/shared/types.ts`、`src/features/repository/branchMenus.ts`、`DeleteRefDialog.tsx`、i18n（repository/errors）；§7 增补同一组文件的标签侧（`delete_tag_remote`、`tagMenuItems`）
- 触发依据：用户需求「新增一个删除本地和远程分支的按钮」「删除改成 删除分支 或删除tag」

## 1. 背景

ADR-0008 的删除只使用安全形态 `git branch -d`，明确不提供远程删除；ADR-0008 §2.6 的确认框也只覆盖本地。用户要求支持删除本地和远程分支，入口为分支右键菜单的专门按钮；同时把菜单项文案从笼统的「删除」改为「删除分支」「删除标签」。

## 2. 决策

1. **契约**：`WriteKind` 新增 `delete_branch_remote`（snake_case），请求复用 `branch` 字段承载分支名；不新增 `delete_tag` 的远程变体（标签远程删除留作后续候选，已于 2026-11-13 由 §7 增补实现）。
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

## 6. 修订记录

- 2026-11-06：远端引用已不存在时按成功收尾。用户反馈「删除本地和远程分支时，远程分支不存在的话，不需要再次弹框提示」。执行阶段 `push --delete` 返回 `remote ref does not exist` 时，`execute.rs` 将该结果标记为 `WriteStatus::Succeeded`（保留 `errors.outcomeRemoteRefMissing` key 与 `branch` 参数、清空 stderr），使 `DeleteRefDialog` 走成功路径直接关闭，而不是停留在失败提示。Gate 的本地缓存判断不变，缓存过期仍由执行阶段兜底。

## 7. 标签远程删除（2026-11-13 增补）

### 7.1 决策

1. **契约**：`WriteKind` 新增 `delete_tag_remote`（snake_case）；请求复用 `branch` 字段承载标签名，与 `delete_tag`、`create_tag` 一致，不新增 `tag` 字段（`WriteRequest` 对标签类操作本来就用 `branch`）。
2. **两段式执行**：前端先发 `delete_tag`（既有本地删除），成功后发 `delete_tag_remote`（`git push origin --delete <tag>`）。仍是「单请求单命令」，`execute.rs` 状态机不改结构。
3. **Gate**（`remote/gate.rs::validate_delete_tag_remote`）：只要求 `remote_count > 0`，并拒绝非法标签名（空、`-` 开头、控制字符）；**不要求本地标签存在**——第一步已经把本地标签删掉了，此时再要求 `refs/tags/<tag>` 存在会把正常的第二段永久判失败。也不要求远程跟踪缓存命中：标签不进 `refs/remotes/`，远端同名标签是否存在由执行阶段兜底。
4. **远端标签不存在**：`push --delete` 返回 `remote ref does not exist` 时沿用 2026-11-06 修订的处理，`remote/failure.rs` 新增 `errors.outcomeRemoteTagRefMissing` 分类，`execute.rs` 同样标记 `WriteStatus::Succeeded`（参数名 `tag`、清空 stderr），对话框走成功路径关闭。
5. **交互**：`tagMenuItems` 新增「删除本地和远程标签」，仅当本地缓存存在 `origin/*` 远程引用时可用（前端没有 remote 列表契约，用缓存近似「已配置 origin」）；`DeleteRefDialog` 按引用类型选择第二段 kind 与标题/警告，远程失败文案沿用分支的「本地已删除，远程删除失败：<stderr>」并保留对话框。
6. **边界保持**：不提供 force push、不提供 `git tag -f`、不提供多 remote 选择、不做 `ls-remote` 实时探测。
7. **已知限制**：远端同时存在同名分支与标签时，`push --delete <tag>` 会被 Git 以 `dst refspec matches more than one` 拒绝（实测不会误删分支），用户需改用显式 refspec 在终端处理；本应用不提供该入口。

### 7.2 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 远程目标写全 `refs/tags/<tag>` | 实测远端缺失时 receive-pack 只警告并返回 0，`remote ref does not exist` 兜底路径失效；裸标签名与 Git 用户直觉一致，歧义时 Git 明确拒绝 |
| Gate 校验本地标签仍在 | 两段式下第一步必然删除本地标签，第二段会被永久判失败 |
| Gate 校验 `refs/remotes/origin/tags/<tag>` | 标签不写远程跟踪引用，该路径恒不存在 |
| 把两段合成一条串行命令 | 破坏「单请求单命令」与独立失败语义（同 §3） |

### 7.3 验收

1. 已配置 origin（本地缓存有 `origin/*`）：标签右键 →「删除本地和远程标签」→ 确认 → 本地与远程标签均消失。
2. 无 origin 远程：菜单项禁用；即使绕过菜单，Gate 以 `gate_remote_missing` 拒绝。
3. 远端同名标签已被他人删除：按成功收尾，不再弹失败提示。
4. 远程删除失败（无权限/网络）：提示「本地已删除，远程删除失败：<stderr>」并保留对话框。
5. 实机验收按 GUI 验收清单 2.9。