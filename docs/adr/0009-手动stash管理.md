# ADR 0009：手动 stash 管理——save / list / apply / pop / drop 与冲突边界

- 状态：草案（待产品确认后实现）
- 日期：2026-11-04
- 影响范围：`crates/git-core/src/dto.rs`（WriteKind / WriteRequest / StashEntryDto）、`crates/git-write/src/stash.rs`（新增，含 `stash/gate.rs` 与测试）、`crates/git-write/src/command.rs`、`crates/git-write/src/execute.rs`、`crates/git-write/src/gate.rs`、`crates/git-read/src/read/stash.rs`（新增）、`src-tauri` command 装配、`src/shared/types.ts`、`src/features/staging/`、`src/app/*`、`src/i18n/locales/*`
- 触发依据：docs/11 批次 3（2026-11-04 用户确认五批次序）；docs/06 N6「不自动 stash」；现有 `WriteKind` 无 stash 能力

## 1. 背景

暂存区已支持查看、stage/unstage、提交与 amend；分支切换在有改动时明确「不会自动 stash」。用户缺少手动 stash 的入口，只能切到终端执行 `git stash`，N6 的遗留诉求（切换前先保存改动）无法在应用内闭环。

本批只做**手动** stash，不引入任何自动 stash、reset、clean 行为。远程操作与凭据问题不在本批范围。

## 2. 决策

### 2.1 白名单与命令构造

`WriteKind` 新增 `StashSave`、`StashApply`、`StashPop`、`StashDrop`。命令构造：

- 保存：`git stash push [--include-untracked] [--message=<文本>]`
- 应用：`git stash apply <selector>`
- 弹出：`git stash pop <selector>`
- 删除：`git stash drop <selector>`

`selector` 仅接受 `stash@{N}` 形态（N 为非负整数），由 Gate 校验后作为独立参数传入；不经 shell，不做字符串拼接。保存消息经单参数 `--message=<文本>` 传递，支持换行；空消息不传该参数，使用 Git 默认的 `WIP on ...` 消息。

不提供 `stash clear`（批量破坏性删除）、`stash branch`、`stash show`；这些能力没有产品确认，终端可完成。

### 2.2 契约

- `WriteRequest` 新增：
  - `stash: Option<String>`：`stash@{N}` 选择器，apply / pop / drop 使用。
  - `include_untracked: Option<bool>`：仅 `StashSave` 使用，缺省 false。
  - 复用既有 `message` 作为 stash 消息。
- 新增只读 DTO：

```text
StashEntryDto {
  index: u32,          // 0 = 最新
  selector: String,    // stash@{index}
  oid: Oid,            // stash 提交对象
  message: String,     // Git reflog 原始消息，不翻译
  created_at: i64,     // reflog 时间（Unix 秒）
}
```

- 新增只读 command `stash_list`，返回 `Vec<StashEntryDto>`，按 index 升序（最新在前）。不新增路径参数，不走通用命令执行通道。

### 2.3 读取路径归 git-read

stash 条目是 `refs/stash` 的 reflog，不是普通 ref 列表。读取实现放在 `git-read/src/read/stash.rs`：

- 查找 `refs/stash`；不存在或 reflog 缺失时返回空列表。
- 使用 gix `reference.log_iter().rev()` 从最新到最旧遍历，index 按遍历顺序编号。
- 解析 `new_oid`、reflog 消息与 signature 时间；消息保持 Git 原文（与「Git 原始内容不翻译」一致）。
- 不调用 `git stash list`，避免在读取路径引入 CLI 解析与平台差异。

### 2.4 Gate 规则

`stash.rs` 校验独立于 `gate.rs`，`gate.rs` 只做分发（沿用批次 2 的拆分方式，避免 gate.rs 越过 600 行）。

| 操作 | 规则 | issue code |
|---|---|---|
| StashSave | bare / 中断态由通用前置拒绝；工作区无任何改动拒绝；仅未跟踪文件且未勾选 include_untracked 时拒绝并提示勾选 | gate_stash_nothing / gate_stash_untracked_only |
| StashApply / StashPop / StashDrop | selector 必须匹配 `stash@{N}`；N 必须小于当前 stash 条目数 | gate_stash_selector_invalid / gate_stash_not_found |

说明：

- 保存只要求「有内容可保存」：`staged > 0 || tracked > 0 || (include_untracked && untracked > 0)`。
- apply / pop 不要求工作区干净：Git 允许在改动之上应用，冲突交由 Git 与既有冲突展示流处理；不在 Gate 阶段额外拦截。
- drop 属于破坏性操作，Gate 只校验存在性，破坏性确认在 UI 完成。

### 2.5 执行状态与冲突

- 成功：save / apply / pop / drop 返回 `Succeeded`，outcome 带对应 key + selector。
- pop 冲突：`git stash pop` 非零退出且 index 出现冲突时，返回 `Conflicted`，携带 `conflict_files`；**stash 条目保留**（Git 语义，需测试固化），前端进入既有冲突展示流并提示先解决冲突再重试。
- apply 冲突：同样进入冲突流；stash 条目本来就不删除。
- 失败（选择器过期、hook 拒绝、权限等）：保留 stderr，提示用户刷新列表后重试；不做任何自动 drop / reset / clean。
- 所有执行继续走 `run_git_output`，进入命令日志。

### 2.6 UI 与交互

- **入口**：StagingView 工具区新增「Stash」按钮，打开 `StashDialog`。
- **列表**：展示 index、消息、创建时间；最新在前。空列表显示空态。
- **保存**：消息输入（可选）+「包含未跟踪文件」复选框（默认关闭）；保存成功后刷新工作区、暂存区、图谱与 stash 列表。
- **apply / pop**：直接执行；pop 的按钮旁提示「成功后该条目会从列表移除」，冲突时保留条目。
- **drop**：专门确认框，展示 selector、短 oid、消息，并给出恢复路径（drop 后对象变为不可达，可用 `git fsck --unreachable` 找到 stash 提交后 `git stash apply <oid>`）；确认后才执行。
- **分支切换 dirty 确认框**：增加「先 stash 当前改动」链接，打开同一个 StashDialog；保存成功后用户可返回确认框继续切换。该链接是本批对 N6 的直接回应。
- 写后刷新沿用既有 `readSnapshot` + `reload` + RefreshCoordinator generation 通道；stash 列表单独重读。

### 2.7 错误与 i18n

新增 stash 域文案（zh/en 同构）与 errors key：

- 列表 / 保存 / apply / pop / drop 的标题、按钮、空态、提示；
- `gate_stash_nothing`、`gate_stash_untracked_only`、`gate_stash_selector_invalid`、`gate_stash_not_found`、`gate_summary_*`、`outcome_stash_*`。

消息内容不翻译；selector 与 oid 保持原样。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 用 `git stash list` CLI 读取 | 读取路径统一走 gix；CLI 输出解析受 locale/版本影响，且与 reflog 直接读取能力重复 |
| 以 stash 提交 OID 作为唯一操作目标 | `git stash drop` 对任意 commit 的支持不稳定；列表索引 + Gate 存在性校验更贴近 Git 语义 |
| 保存时默认包含未跟踪文件 | 会把构建产物、临时文件一并 stash，副作用大；必须显式勾选 |
| 自动 stash 后切换分支 | 违反 docs/06 N6；本批只提供手动入口与引导 |
| pop 失败后自动 drop / reset | 会丢失用户数据；失败必须保留 stash 与工作区现状 |
| 提供 stash clear | 批量不可逆删除，超出本批范围；终端可完成 |

## 4. 后果

- `WriteKind` 15→19；新增 git-write `stash.rs` / `stash/gate.rs` 与 git-read `read/stash.rs`，新增 `stash_list` command 与 `StashDialog`；i18n 由 check-i18n 门禁覆盖。
- 用户可以完成「保存改动 → 切换分支 → 回来恢复」闭环；stash 的冲突仍复用既有冲突展示与继续/中止能力。
- 自动 stash 禁令不变；远程凭据与 push/pull 不在本批。

## 5. 待产品确认

1. pop 是否需要二次确认？建议直接执行，但按钮旁提示「成功后条目移除」；drop 必须专门确认。
2. 「先 stash 当前改动」链接是否纳入首版？建议纳入（直接回应 N6）。
3. stash 列表是否需要展示分支名？reflog 消息已包含 `WIP on <branch>`，首版直接展示原始消息，不额外解析。
4. include_untracked 默认关闭，是否符合预期？
5. drop 的恢复说明是否采用 `git fsck --unreachable` + `git stash apply <oid>` 文案？

## 6. 验收清单（实现完成的判定）

1. 有 tracked 改动时 save：工作区恢复干净，stash 列表新增 1 条，消息与时间正确。
2. 仅未跟踪文件、未勾选 include_untracked：Gate 拒绝并提示勾选；勾选后 save 成功，未跟踪文件被收纳。
3. 工作区无改动：Gate 拒绝 `gate_stash_nothing`。
4. apply 后 stash 条目保留，文件内容经独立 `git diff` 核对恢复。
5. pop 成功后条目移除；pop 冲突时条目保留、冲突文件可见，可进入既有冲突展示流。
6. drop 移除指定条目，其余条目索引前移；selector 越界被 Gate 拒绝；确认框展示 oid 与恢复说明。
7. `stash_list` 与 `git stash list` 的条目数、顺序、消息一致（独立核对）。
8. 分支切换 dirty 确认框的「先 stash」入口可用，保存后返回可继续切换。
9. `npm run check` 全绿；触及文件行数合规（新文件 ≤400，存量文件只减不增）。