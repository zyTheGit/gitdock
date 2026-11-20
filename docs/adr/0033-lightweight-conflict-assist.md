# ADR-0033：轻量级冲突解决辅助

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`crates/git-core/src/dto/write.rs`（WriteKind 36 → 39）、`crates/git-write`（`gate.rs`、`execute.rs`、`command.rs`、`outcome.rs`、新增 `conflict/{mod,gate,tests}.rs`、集成测试 `tests/write_conflict.rs`）、`src/shared/types.ts`、`docs/03-技术架构.md`、前端暂存区冲突分组（按钮、确认框与 i18n，另行实现）
- 触发依据：任务 T12 子任务 12B「轻量级冲突解决辅助」

## 1. 背景

冲突文件目前只在暂存区单列展示，操作提示是「请在终端解决」。实际工作中约 80% 的冲突是两种简单情形：**整文件取一侧**（生成了文件、配置、版本号等），或**已手工改好、只差一个 `git add`**。把这两种动作留在终端，用户需要离开界面、手敲路径，且容易 `git add .` 误收别的文件。

同时，应用长期坚持「绝不自动 continue / abort」：解决冲突是用户动作，收尾（continue / abort）也必须由用户显式点击。本 ADR 只补「解决单个冲突路径」的三种受限动作，不引入任何自动收尾。

## 2. 决策

### 2.1 契约：三个 kind，复用 `path`

| WriteKind（snake_case） | 命令 | 副作用范围 |
|---|---|---|
| `resolve_conflict_ours` | `git checkout --ours -- <path>` | 只覆盖工作区文件 |
| `resolve_conflict_theirs` | `git checkout --theirs -- <path>` | 只覆盖工作区文件 |
| `mark_conflict_resolved` | `git add -- <path>` | 只改索引（写 stage 0 条目） |

- **三个 kind 而不是一个带参数的动作**：`checkout` 与 `add` 的副作用边界不同（工作区 vs 索引），前端需要能表达「只覆盖、暂不标记」，Gate 的摘要与文案也完全不同。
- **请求复用已有 `path` 字段**（仓库内相对路径，单路径），不新增字段；旧请求体不受影响。
- **不新增 Tauri command**：`validate_write` / `execute_write` 已承载受限 DTO + Gate，三个 kind 走现有单命令管线，共用同一把仓库写锁与命令日志；多开入口只会多一处待审计的跨进程面。

### 2.2 checkout 与 add 的区别（为什么拆两个动作）

- `checkout --ours/--theirs` 只把**工作区文件**替换成某一侧的内容，索引里的 unmerged 条目（stage 1/2/3）原样保留：`git status` 仍显示该路径冲突，用户还能改主意取另一侧，或取完后继续手工编辑。
- `mark_conflict_resolved` 用**工作区当前内容**写 stage 0 条目，冲突从这个路径消失——这是收尾动作，必须由用户显式触发。
- 因此前端「采用 Ours」按钮**不得顺手 add**：自动 add 会让用户失去再次选择与继续编辑的机会。成功文案固定写明「该文件仍未暂存，确认后请标记为已解决」。

### 2.3 Gate 规则

前置校验与其他写操作一致：bare 仓库拒绝（`gate_bare_repository`）。`gate_interrupted`（存在未完成操作即拒绝）**对这三个 kind 豁免**——冲突就发生在 merge / rebase / cherry-pick / revert / stash apply 的中断态内部，若沿用该拒绝，功能在主场景下完全不可用。豁免只对这三个 kind 生效，`request.interruption` 的「仅续/中止可指定」规则不变。

逐条校验（按序，任一失败即拒绝整个请求）：

| 顺序 | issue key | 条件 |
|---|---|---|
| 1 | `gate_unborn_head` | 当前分支尚无提交 |
| 2 | `gate_conflict_path_required` | `path` 缺失或为空 |
| 3 | `gate_invalid_path` | 含控制字符、绝对路径 / 盘符 / UNC、`..` 分段、反斜杠、`-` 选项注入（`safe_rel_path` + `unsafe_path_shape` + `is_control`） |
| 4 | `gate_git_dir_path` | 首段为 `.git`（大小写不敏感） |
| 5 | `gate_conflict_path_not_conflicted` | `path` 不在实时 `staging_status().conflicted_files` 中 |

**不要求中断态**（`stash apply` 同样会产生冲突），但**必须在 Gate 时刻确认该路径确实是 conflicted**：过期 UI、外部 `git add` 或拼写错误都在这里被拒，而不是让 `checkout` 把某个正常文件的改动冲掉。

warning（非阻断，`GateReportDto.warnings`）：

| code | 条件 | `args` |
|---|---|---|
| `conflict_markers_present` | `mark_conflict_resolved` 且工作区文件仍含行首 `<<<<<<<` / `=======` / `>>>>>>>` | `path`、`marker` |

扫描规则：只认行首标记；读取上限 2 MiB；含 NUL 视为二进制、超过上限、读失败、符号链接解析到仓库外——一律**跳过扫描**（不告警、不阻断）。它是**提示而非判定**：文档里恰好以 `<<<<<<<` 开头的示例行也会命中，所以 Gate 保持 `ok`，由前端要求二次确认。

### 2.4 摘要与结果文案

| 场景 | summary_key | args |
|---|---|---|
| 采用一侧 | `errors.gateSummaryResolveConflictOurs` / `...Theirs` | `path` |
| 标记已解决 | `errors.gateSummaryMarkConflictResolved` | `path` |

| 结果 | key | args |
|---|---|---|
| ours 成功 | `errors.resolveConflictOursDone` | `path` |
| theirs 成功 | `errors.resolveConflictTheirsDone` | `path` |
| 标记成功 | `errors.markConflictResolvedDone` | `path` |
| 非零退出 | `errors.outcomeGitRejected`（现有兜底） | `path` |

摘要与文案都**不声称哪一侧是「当前分支」**，只说「所选一侧（ours / theirs）」——原因见 §3.1。

### 2.5 接入方式

- `command.rs`：三个 kind 构造参数数组，路径一律放在 `--` 之后；无 stdin、无 shell 字符串。
- `gate.rs`：分派到 `conflict::gate::validate_conflict`（返回 issues / warnings / affected_paths / summary）。
- `execute.rs`：走现有单命令管线（无需专用执行器），只补非零退出的失败文案。
- 结果以退出码判定，与其它写操作一致；成功后前端用刷新后的 `staging_status` 更新冲突分组。

## 3. 语义与副作用

### 3.1 rebase 下 ours / theirs 反转

- **merge / cherry-pick / revert**：`--ours` 是当前已签出的分支（合并目标），`--theirs` 是被合入的提交。
- **rebase（含 `pull --rebase`）**：Git 语义反转——`--ours` 是**上游 / onto 一侧**，`--theirs` 是**正在重放的提交**，也就是用户通常理解的「我的提交」。

因此 Rust 侧摘要与结果文案不写「当前分支」，前端必须按 `interruption.kind` 决定按钮标签与确认框说明：rebase 中断时提示「语义已反转（ours = 上游，theirs = 被重放的提交）」。这是本功能唯一需要前端承担 Git 语义知识的地方，且只用于**文案**，不参与校验。

### 3.2 其它副作用与边界

- `checkout` 成功后该路径**仍留在冲突分组**（索引未变），直到 `mark_conflict_resolved` 才消失；若解决后的内容与 HEAD 相同，索引回到 HEAD，该文件不会出现在 staged 列表（没有新改动）。
- 一侧删除文件时 `checkout` 可能报错，应用**不自动 `git rm`**，按失败报告并提示终端处理。
- 不自动 continue / abort：冲突全部解决后，顶部横幅的「继续」仍由用户手动点击。
- 不调用外部合并工具（`$LOCAL $REMOTE $BASE $MERGED` 模板与三栏合并器不在本期范围）。

### 3.3 二进制与 gitlink

本期**不承诺**二进制冲突与 gitlink（子模块）冲突的解决能力，也没有专门类型判定：

- 二进制冲突：`checkout --ours/--theirs` 可以整文件取一侧（这本身是合理解决方式），但残留标记扫描会因 NUL 跳过；应用不把「二进制冲突已解决」当作可验证结论，只如实报告命令结果。
- gitlink 冲突：`checkout` 只改父仓库索引/工作区中的子模块引用，**不会**同步子模块内部工作区，`add` 之后提交的指针可能与本地子模块实际状态不一致。此类冲突建议在终端处理。
- 两者都不做额外 Gate 类型检查：porcelain v2 的 `u` 条目只给路径与模式，判定类型需要再跑一次索引查询，收益低于成本；前端可以对已知二进制 / 子模块路径加提示文案。

## 4. 安全边界

- 白名单化：三个 kind 是唯一入口，前端不能传任意命令或路径列表。
- 单路径 + Gate 时校验「当前确实 conflicted」：不会误伤正常文件，也不能一次冲掉多个冲突。
- 参数数组 + `--` 分隔：路径即使包含空格、中文、前导 `-`（被 Gate 拒绝）也不会被当作选项。
- 可在中断态内执行，但**没有任何收尾能力**：不运行 `--continue` / `--abort` / `--skip`，不 stash、不 reset、不 clean。
- `mark_conflict_resolved` 只 `add` 指定路径（不带 `-A` / `-u`），不会连带暂存其它改动。
- 残留标记 warning 只提示、不阻断，也不替用户判定「已解决」。

## 5. 测试与验证

- 单元（`conflict/tests.rs`）：命令参数形态（`--` 在路径前、无 `-A`）、kind 映射、路径拒绝（空 / 绝对 / 盘符 / UNC / `..` / 反斜杠 / 选项注入 / 控制字符 / `.git`）、行首标记识别（缩进与行内不算）、二进制 / 超限 / 缺失 / 越界路径跳过扫描。
- 集成（`tests/write_conflict.rs`，真实 merge 冲突夹具）：`resolve_conflict_ours` 后工作区为 ours 且仍 conflicted → `mark_conflict_resolved` 后冲突消失、索引内容正确；`resolve_conflict_theirs` 同构；残留标记触发 `conflict_markers_present` 且 Gate 仍 `ok`，覆盖成 ours 后不再告警；非冲突路径、缺失 path、非法路径全部拒绝且工作区零改动。
- 命令：`cargo test -p git-core`、`cargo test -p git-write`、`cargo check -p git-core -p git-write --all-targets`、`cargo clippy -p git-core -p git-write --all-targets -- -D warnings` 全绿。

## 6. 不在范围内

- 外部合并工具入口与 `$LOCAL $REMOTE $BASE $MERGED` 模板配置。
- 冲突文件的 hunk 级解决、三栏合并视图、冲突 diff 渲染。
- 自动 continue / abort / skip，以及「全部取一侧」批量动作。
- 二进制 / gitlink 冲突的专门判定、提示与解决流程。
