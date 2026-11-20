# ADR 0029：本地回退 reset 与只读 Reflog 恢复视图

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`crates/git-core/src/dto/write.rs`（`WriteKind::Reset`、`ResetMode`、`WriteRequest::reset_mode`）、`crates/git-core/src/dto/repo.rs`（`ReflogEntryDto`）、`crates/git-write`（`gate.rs`、`command.rs`、`execute.rs`、`outcome.rs`、`probe.rs`、新增 `reset/{mod,gate,tests}.rs`、集成测试 `tests/write_reset.rs`）、`crates/git-read`（新增 `read/reflog.rs`、测试 `tests/read_reflog.rs`）、`src-tauri/src/app/commands/read.rs` 与 `src-tauri/src/lib.rs`（`read_reflog` command）、`src/shared/types.ts` 与 `ipc.ts`、`docs/03-技术架构.md`、前端（重置对话框 / Reflog 视图 / i18n，另行实现）
- 触发依据：任务 T09「本地回退 Reset 与 Reflog 恢复视图」

## 1. 背景

分支指向错位（错误的提交、误 amend、误 rebase）之后，用户需要两件事：

1. 把当前分支**回退到指定提交**，并按意图决定暂存区与工作区怎么处理（`git reset --soft|--mixed|--hard`）；
2. 当回退做过头时，从 **reflog** 找回原来的提交。

这两件事的安全性质完全不同：`--soft` / `--mixed` 可逆（改动都还在），`--hard` 会**永久丢弃未提交改动**（不受 reflog 保护），而 reflog 本身是 Git 自动维护的只读历史。因此 reset 必须进写白名单、过 Gate、按模式分级确认；reflog 只能只读读取，不能变成「任意引用写回」的后门。

## 2. 决策

### 2.1 契约：单一 `WriteKind::Reset` + 显式 `reset_mode`

`WriteKind` 只新增一个变体 `reset`，模式通过 `WriteRequest::reset_mode` 传递，目标提交复用既有 `oid` 字段。

```rust
// git-core::dto::write
WriteKind::Reset

#[serde(rename_all = "snake_case")]
pub enum ResetMode { Soft, Mixed, Hard }

pub struct WriteRequest {
    // ...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_mode: Option<ResetMode>,
}
```

- **一个 kind 而不是三个**：soft / mixed / hard 是同一条命令的不同参数，Gate 判定与执行管线完全共用；拆成三个 kind 只会让 `gate.rs` 的 match 长三倍、且前端要维护三套请求构造。
- **`reset_mode` 用 serde 默认值**：旧前端（不含该字段）仍能反序列化出 `None`；`reset` 收到 `None` 时 Gate 拒绝（`gate_reset_mode_required`），执行期 `require_mode` 再兜底。**不替用户猜模式**——缺省值一旦选错，`--hard` 会直接毁数据。
- **`ResetMode` 是契约枚举而非字符串**：模式参与 Gate 分支与文案选择，字符串会退化成运行时比较；`snake_case` 序列化与 `WriteKind` 一致。
- **代价**：`WriteRequest` 多一个可选字段；`reset` 之外的操作忽略它（Gate 不校验、执行不读）。

### 2.2 命令形态

`git reset --soft|--mixed|--hard <完整 OID>`，参数数组启动，OID 由 `Oid` 校验为完整十六进制，不构成选项注入。

- 不提供 `--keep` / `--merge`：语义与 `--hard` 相近但保留规则复杂（`--keep` 在本地改动会与目标冲突时失败），本期只开放三种标准模式，另两种留给终端。
- 不提供「重置到任意 ref 表达式」：目标必须是已存在的 commit（见 2.3），前端从图谱 / Reflog 拿到的是 OID。
- **不新增 Tauri command**：`validate_write` / `execute_write` 已承载受限 DTO + Gate，reset 复用同一把仓库写锁与命令日志。多开一个入口只多一处需要审计的跨进程面。

### 2.3 Gate 规则

reset 的校验集中在 `reset/gate.rs::validate_reset`，`gate.rs` 只做分派与合并。bare 仓库与中断态（cherry-pick / revert / merge / rebase 进行中）由 `gate.rs` 前置拒绝，reset 不再重复判定。

| 顺序 | issue key | 条件 |
|---|---|---|
| 1 | `gate_reset_mode_required` | `reset_mode` 缺失 |
| 2 | `gate_unborn_head` | 当前分支尚无提交（无 HEAD 可移动） |
| 3 | `gate_conflicted_index_reset` | `status` 中存在未解决冲突条目（与 stage / discard / hunk 一致，先收尾再重置） |
| 4 | `gate_reset_target_required` | 缺少 `oid` |
| 5 | `gate_reset_target_invalid` | `oid` 无法解析为 commit（树 / blob / 不存在 / 拼写错误），复用只读 `rev-parse --verify --quiet <oid>^{commit}` |
| 6 | `gate_reset_noop` | 目标就是当前 HEAD 且该模式无实际效果：soft 永远无效果；mixed 在索引干净时无效果；hard 在索引干净且无已跟踪改动时无效果（未跟踪文件不算，`--hard` 不删它们） |

第 5 步把「不是提交」的拒绝提前到 Gate：`git reset` 对树对象会移动分支指针指向一个非 commit，属于必须避免的状态。

**放行但报告（warning，不阻断）**：

| warning code | 条件 | `args` |
|---|---|---|
| `reset_hard_destructive` | 模式为 `hard` 且工作区 / 索引有内容 | `oid`、`total`、`staged`、`tracked`、`untracked`；同时填 `affected_paths`（≤50 条）与 `affected_total` |
| `reset_diverges_upstream` | 目标**落后于**上游：目标在上游历史上、上游不在目标历史上 | `oid`、`upstream` |

- `affected_paths` 含未跟踪路径（用户需要知道这些文件「在重置范围内」），但 warning 文案明确写出**未跟踪文件不会被删除**。计数按状态侧统计：同一文件既有暂存又有工作区改动时 `staged` / `tracked` 各计一次，`affected_total` 是去重路径数，因此 `affected_total` 可能小于三者之和。
- 分叉提示只覆盖「会把已推送的提交从本地分支上丢掉」这一真实风险。字面上的「目标不是上游祖先」会把**每次普通本地回退**（回退未推送的本地提交，最常见用法）都标成警告，噪音压过信息，故不采纳。目标 == HEAD 时跳过提示。
- 上游提示只读：`git merge-base --is-ancestor` 两次（目标 vs 上游、上游 vs 目标），退出码 0/1 之外的任何情况（浅克隆边界、引用缺失）视为「无法判定」并静默跳过，绝不因此阻断写操作。
- detached HEAD 不拒绝（`git reset` 在 detached HEAD 上是合法且有用的），此时没有上游概念，跳过 2.2 的分叉提示。

**summary**：`errors.gateSummaryReset`，`summary_args = { mode, oid(短 8 位), branch, total }`；分支缺失时 `branch` 取 `HEAD`。

### 2.4 破坏性确认（前端契约）

- `hard` 必须走强破坏性确认：标红、展示 `affected_paths` 与 `affected_total`、要求显式确认，文案必须区分两个层次——
  - **已提交的历史可恢复**：重置会写入 `HEAD` reflog，旧提交可从 Reflog 视图找回；
  - **未提交的暂存 / 工作区改动不可恢复**：它们不经过 reflog，`--hard` 结束后无法通过本应用找回（需要保留请先 Stash）。
- `soft` / `mixed` 用普通确认框即可（改动都保留，只是位置变化），但仍需展示 Gate summary 与分叉 warning。
- 所有 warning 必须进入确认框正文，不能只留在日志里。

### 2.5 结果文案

| 场景 | key | `args` |
|---|---|---|
| soft 成功 | `errors.outcomeResetSoft` | `oid`、`mode` |
| mixed 成功 | `errors.outcomeResetMixed` | `oid`、`mode` |
| hard 成功 | `errors.outcomeResetHard`（提示原提交可经 Reflog 找回） | `oid`、`mode` |
| Git 非零退出 | `errors.outcomeResetRejected`（未移动分支指针） | `oid`、`mode` |
| 执行期缺模式（兜底） | `errors.resetModeRequired` | — |
| 执行期缺目标（兜底） | `errors.commandMissingOid` | — |

### 2.6 Reflog 读取策略（git-read）

新增 `GitReadModule::read_reflog(limit)`，`ReflogEntryDto` 由 `git-core` 定义，经 `read_reflog(limit?)` Tauri command 暴露。

- **只读 `HEAD` reflog**：不做任意 ref 的 reflog（那会变成「引用历史浏览器」的新能力面），也不读 stash reflog（已有 `read_stashes`）。
- **最新在前**：`index = 0` 对应 `HEAD@{0}`，`selector` 由服务端拼好。前端不要把 `index` 当成分页 offset，也不自行拼接 `HEAD@{N}`。
- **条数上限**：默认 200（`DEFAULT_REFLOG_LIMIT`），硬上限 1000（`MAX_REFLOG_LIMIT`），请求值 clamp 到 `[1, 1000]`。reflog 只用于「找回最近的提交」，不做全量导出。
- **纯 gix**：`repo.head()?.log_iter().rev()`，不启动子进程、不写文件，因此满足 git-read 的只读静态审计（无 `Command::new`、无 `--hard` 字面量、无 fs 写入）。
- **失败降级**：仓库没有 reflog 文件（`core.logAllRefUpdates=false` 或刚 init）时返回**空列表**而不是错误；单行解析失败才报错。
- **删除条目**：`new_oid` 为全零哈希的行（引用被删除）不返回——本视图的用途是「找回提交」，指向空对象的行没有可恢复内容；`old_oid` 为空哈希（首条记录）时序列化为 `null`（`Option<Oid>`，故意不使用 `skip_serializing_if`，让前端拿到稳定的 `string | null` 形状）。
- **`message` 原样返回**：`commit: ...`、`reset: moving to ...` 是 Git 原始文本，不翻译、不解析；前端展示时按纯文本转义。
- **`created_at` 为 Unix 秒**（reflog signature 的提交时区无关时间），前端自行按本地时区格式化。
- **不做** `git reflog expire` / `gc`：reflog 的清理交给 Git 自身的 `gc.reflogExpire` 策略与本用户的终端；应用永不主动删历史。

### 2.7 UI 形态（前端决策，供实现参考）

- **重置**：`ResetDialog`，从提交右键菜单 / 提交详情动作区打开。内部选择模式（三选一，`hard` 选中后整块标红并展开受影响路径）、展示 Gate summary 与 warning、确认后发 `execute_write`（kind = `reset`）。当前分支 HEAD 上右键时同样可用（此时多半会被 `gate_reset_noop` 拒绝，前端直接展示 issue 文案即可）。
- **Reflog**：`ReflogDialog`（独立只读弹窗，从提交菜单或顶栏「历史 / 恢复」入口打开），不放在主图谱面板里——它是低频救命功能，常驻会挤占图谱空间。列表展示 `selector` / 短 OID / 时间 / `message`，行内动作只允许**派发既有写操作**：在该提交创建分支（`create_branch`）、cherry-pick（`cherry_pick`）、对比（只读）。不提供「把分支直接移动到该条目」的按钮——那正是 reset 对话框的职责，两处并存会让破坏性操作绕过 2.4 的确认。
- 两者都用 `features/repository/` 或 `features/write/` 现有弹窗样式，不新引组件库。

### 2.8 明确不做（Out of Scope）

| 项 | 原因 |
|---|---|
| `git reflog expire` / `git gc` | 主动删历史不可逆，且不属于「找回提交」的用户意图 |
| 多选 / 批量重置多个分支 | 当前一次写操作只作用于当前 HEAD；批量移动多分支没有可解释的确认语义 |
| `reset --keep` / `--merge` | 保留规则复杂（可能中途失败留下混合状态），终端可用 |
| reset 到任意 ref 表达式（`HEAD~2`、`main@{1}`） | 目标必须是已存在 commit 的 OID；表达式解析会引入新的注入面 |
| 在 Reflog 视图内直接移动分支指针 | 绕过 reset 对话框的破坏性确认 |
| 非 `HEAD` 的 reflog 浏览 | 扩大只读能力面，暂无需求 |
| 索引冲突时 reset | 与 stage / discard / hunk 保持一致：先解决冲突或中止当前操作 |

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 三个 WriteKind（`reset_soft` / `reset_mixed` / `reset_hard`） | Gate、命令构造、文案三处 match 各长三倍，前端也要三套请求；模式本就是同一命令的参数 |
| `reset_mode` 缺省为 `mixed` | 缺省值决定数据存亡（`--hard`），对未升级前端静默套用 `mixed` 也不符合「用户点了什么就做什么」 |
| 用 `git rev-parse <oid>^{commit}` 在**执行期**才校验目标 | 非 commit 目标会先移动分支指针再报错，必须前置到 Gate |
| reset 走专用 Tauri command | 通用 validate / execute seam 已够用，多开入口违反「不给前端开通用命令通道」 |
| 分叉提示按「目标不是上游祖先」判定 | 会把每次普通本地回退都标黄，噪音压过信息；改为「目标严格落后于上游」 |
| 分叉提示失败即拒绝 | 浅克隆 / 上游缺失属于环境问题，不该阻断用户本来想做的本地回退 |
| reflog 用 `git reflog show` 子进程 | git-read 只允许 gix；gix 的 `head().log_iter()` 已能给出全部字段，且天然满足只读审计 |
| reflog 无条目时报错 | 「刚 init / 关闭了 reflog」是正常状态，空列表才符合 UI 预期 |
| 返回 `new_oid` 为空哈希的删除条目 | 没有可恢复内容，前端还要额外判空；直接过滤 |
| Reflog 列表直接提供「移动分支到此」按钮 | 破坏性操作必须走 reset 对话框的确认流程，否则等于开了旁路 |

## 4. 后果

- `WriteKind` 增至 36 项，`types.ts` 同步新增 `ResetMode`、`WriteRequest.reset_mode`、`ReflogEntryDto`，`ipc.ts` 新增 `read_reflog(limit?)`。
- `WriteRequest` 新增可选字段，旧前端请求仍可解析；`reset` 请求缺模式时得到明确的 `gate_reset_mode_required`，不是静默默认。
- Gate 报告新增 `reset_hard_destructive` 与 `reset_diverges_upstream`；前者自带 `affected_paths`，前端确认框必须渲染。
- `git-write` 新增只读 `is_ancestor` 探测（`merge-base --is-ancestor`），只用于 warning，不参与放行判定。
- `git-read` 新增纯 gix reflog 读取与 `read_reflog` command；`v2_readonly` 静态审计继续覆盖新文件。
- reflog 视图的完整性受 Git 配置影响（`core.logAllRefUpdates=false` 的仓库没有 reflog），前端需能展示「无可恢复记录」的空态。
- 重置写入的 reflog 条目由 Git 负责，应用不校验也不修补；`--hard` 的不可恢复部分（未提交改动）只能靠 2.4 的确认框防呆。

## 5. 验收

1. soft 重置后分支指向目标提交，原已暂存改动仍在索引中（`A  b.txt`），工作区未变。
2. mixed 重置后索引清空、改动退回工作区未暂存；文件内容保留。
3. hard 重置后已跟踪改动被丢弃、未跟踪文件保留，Gate 返回 `reset_hard_destructive` 且 `affected_total` 与 `affected_paths` 匹配。
4. 树对象 OID、不存在的 OID → `gate_reset_target_invalid`；缺 `reset_mode` → `gate_reset_mode_required`；缺 `oid` → `gate_reset_target_required`。
5. unborn HEAD → `gate_unborn_head`；目标 == HEAD 且无内容可重置 → `gate_reset_noop`（三种模式各自成立）；有已暂存内容时 mixed 到 HEAD 被放行且确实清空索引。
6. 目标落后于上游：出现 `reset_diverges_upstream`（`args.upstream` 为跟踪分支名）；目标在上游顶端、或回退未推送的本地提交时不出该 warning。
7. `read_reflog` 返回最新在前的条目，`selector` 与 `index` 对齐，条目数受 `limit` 与 1000 上限约束；无 reflog 的仓库返回空向量；`v2_readonly` 静态审计覆盖 `read/reflog.rs` 通过。
8. `cargo fmt --all -- --check`、`cargo clippy -p git-write -p git-read -p git-core -p gitdock-app --all-targets -- -D warnings`、`cargo test -p git-write -p git-read -p gitdock-app` 全绿；触及文件 ≤ 600 行，新增文件 ≤ 400 行。
