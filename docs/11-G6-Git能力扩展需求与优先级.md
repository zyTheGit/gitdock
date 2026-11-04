# G6：Git 能力扩展——需求与优先级方案（前置）

> 状态：**方案产出，优先级待产品裁决**（docs/08 裁决点 4）。每项能力在实现前仍须单独形成需求细化、ADR 与验收标准（goal 硬规则），本文档只定分组、批次与依赖，不构成任何一项的实现授权。

## 1. 现状底座与扩展成本模型

现有写操作白名单 8 种（`crates/git-core/src/dto.rs:448-457` `WriteKind`）：CherryPick、Revert、SwitchBranch、SetBranchDescription、StageFiles、UnstageFiles、ContinueOperation、AbortOperation。**没有** commit（提交）、分支创建/删除、标签、stash、fetch/pull/push、merge/rebase。

新增一项写操作的固定全链路成本（架构既有模式，所有批次共享）：

| 层 | 落点 | 说明 |
|---|---|---|
| 契约 | git-core `dto.rs`（WriteKind）+ `src/shared/types.ts` | 全链路同步变更 |
| 构造 | git-write `command.rs:69-170` `command_for()` | 参数数组白名单形态 |
| 校验 | git-write `gate.rs`（现 527 行，逼近 600 硬上限） | 新 Gate 语义需考虑拆分新校验模块 |
| 装配 | src-tauri command 注册 | 既有模式 |
| 前端 | ipc.ts + useWriteFlow（Gate→确认→执行流已就绪） | 确认框/入口组件按能力新增 |
| i18n | zh-CN/en 资源 + check-i18n 门禁 | 既有门禁自动覆盖 |

既有可复用资产：统一写流程 hook（`src/app/useWriteFlow.ts:45`，Gate→确认→执行）、写互斥锁（`execute.rs:15-18`）、中断恢复框架（现仅接管单次 cherry-pick/revert，`command.rs:360-370`）、33 个 Gate issue code（`gate.rs`）、刷新协调器（写后标脏）。

## 2. 能力分组

### A. 提交创建与修改（amend）

- 范围：从暂存区创建提交（消息编辑）；amend 修改最近一次提交（消息/内容）。
- Gate 要点：空暂存拒绝（可复用 `gate_nothing_to_stage` 语义）、空消息拒绝、中断态中禁止（`gate_interrupted` 既有）、amend 需 HEAD 存在（unborn 拒绝）。消息经临时文件传递（`--file`），参数数组天然避免转义问题。
- amend 属**历史改写**：专门确认（展示将被替换的提交）+ 恢复说明（reflog 指引）。
- UI 入口：StagingView（暂存区已有视图，唯一缺口是没有提交按钮）。
- 风险：低。纯本地、失败无数据损失。

### B. 分支与标签管理

- 范围：分支创建（自当前 HEAD/图谱选中提交）、删除、重命名；标签创建（轻量+附注）、删除。
- Gate 要点：分支名合法性、已存在拒绝、不能删当前分支/多处 checkout（`gate_branch_checked_out` 可复用）、`-d`（已合并）与 `-D`（未合并，**破坏性**需专门确认+恢复说明）、detached HEAD 建分支是合法高频诉求。
- UI 入口：RepositorySidebar 分支列表 + 图谱节点右键菜单。
- 风险：低（纯 refs 操作，不触工作区）。删除未合并分支 `-D` 是唯一高危点。

### C. stash

- 范围：save（含 untracked 选项，须显式勾选）、list 展示（git-read 新读路径）、pop/apply、drop。
- Gate 要点：pop/apply 冲突可能（产生 conflicted index，进入既有冲突展示流）；drop **破坏性**确认；空工作区 save 拒绝。
- 边界：docs/06 N6「不自动 stash」禁令不变——本项只提供**手动** stash；分支切换 Gate 的 dirty 确认框可引导用户先手动 stash（解决 N6 遗留诉求）。
- UI 入口：StagingView 工具区 + 分支切换确认框的引导链接。
- 细化方案：ADR-0009（已接受并实现，PR #10 / `b5cc7e4` 已合并；GUI 实机验收待用户）。
- 风险：中（pop 冲突路径需要验证）。

### D. 远程同步（fetch / pull / push）

- 范围：fetch（更新远程跟踪 refs）、pull（首版限 `--ff-only`，完整形态依赖 E 组 merge/rebase）、push（普通推送，non-ff 拒绝；`--force` 形态是否进白名单待该组 ADR 单独裁决——破坏性远程操作）。
- **凭据硬约束（goal 规则 + 现状技术事实）**：远程凭据不得被 GitDock 记录；且 git-core 执行器现注入 `GIT_TERMINAL_PROMPT=0`，交互式凭据提示会直接失败。因此方案方向：GitDock 内**不出现密码输入框**；HTTPS 依赖系统凭据管理器、SSH 依赖用户 key/agent；首次授权失败时引导用户在内置终端完成一次 fetch（终端内凭据交互不经过 GitDock）或系统层配置。该策略在该组 ADR 定稿。
- fetch 是纯读操作（本地 refs 只增不改），风险最低。
- 风险：中高（网络/凭据/大仓库超时；`update.rs` 的 ureq+native-tls 与 git CLI 网络栈是两套，无共享瓶颈）。

### E. merge / rebase / 批量序列

- 范围：merge（含非 ff merge commit）、rebase（本地历史改写）、cherry-pick/revert 多提交序列（现单次限制的扩展）、完整 pull。
- Gate 要点：中断恢复框架需扩展——现仅接管单次 cherry-pick/revert（`gate.rs` 的 interruption 系列针对 sequencer 单次态），merge 的 `MERGE_HEAD` 态与 rebase 的目录形态是**新接管语义**；冲突路径复用既有 conflicted index 展示。
- rebase 属**历史改写**：专门确认 + 恢复说明（`--abort` 即恢复，中断态可延续）。
- 风险：高（冲突 UI 与状态机复杂度集中在此组；`MergeCommitUnsupported` 等 ErrorCode 已预留部分语义）。

## 3. 推荐批次与理由

遵循 docs/08 裁决点 4 的推荐序（提交/分支与标签/stash → 远程同步 → merge/rebase）：

| 批次 | 内容 | 理由 |
|---|---|---|
| 1 | A 提交创建与修改 | 最高频；暂存区视图已就绪、唯一缺口；纯本地零风险 |
| 2 | B 分支与标签管理 | 纯 refs 操作；图谱/侧栏入口自然；为后续批次提供操作素材 |
| 3 | C stash | 补齐 N6 遗留诉求；依赖既有冲突展示流 |
| 4 | D 远程同步（fetch + pull --ff-only + push 基础） | 凭据策略 ADR 定稿后落地；完整 pull 留待批次 5 |
| 5 | E merge/rebase/批量序列 + 完整 pull | 冲突状态机最复杂，放最后；届时中断恢复框架一并扩展 |

可选微调：fetch 只读无破坏性，若用户工作流重度依赖远程，可提前至批次 2/3 并行（不阻塞本地主线）。

每批交付形态：单项需求细化 → ADR → 实现 → 验收（含工作区/refs 实际状态独立测试验证），批次内可按能力逐项独立合入。

## 4. 通用约束（全批次生效）

1. **白名单 + Gate 是唯一扩展通道**：不绕过 WriteKind/command_for/gate 直发 Git 命令；写互斥锁语义不变。
2. **远程凭据不得被应用记录**（D 组 ADR 细化：无密码输入框，系统凭据/SSH agent/终端授权引导）。
3. **历史改写与破坏性操作必须专门确认 + 恢复说明**：amend、分支 `-D`、分支重命名、stash drop、标签删除、rebase、（如纳入的）push force。
4. **gate.rs 已 527 行**：批次 1 起的新校验按场景拆独立模块（行数硬规则），不顺手重构既有逻辑。
5. 所有写后刷新走 RefreshCoordinator generation（既有）；终端内 Git 操作后的同步依赖 N8 既有机制。

## 5. 裁决记录

**2026-11-04 用户裁决：选项 A——五批次序**（提交创建+amend → 分支+标签 → stash → 远程基础 → merge/rebase/批量序列+完整 pull）。批次 1（提交创建与 amend）已按 ADR-0007 实现（e607131，门禁全绿，GUI 实机验收待用户）；批次 2（分支与标签管理）已按 ADR-0008 实现（分支创建/删除/重命名、本地轻量/附注标签创建与删除，门禁全绿，GUI 实机验收待用户）。**批次 3（stash）已按 ADR-0009 实现并合并（PR #10 / `b5cc7e4`；save/list/apply/pop/drop，门禁全绿，GUI 实机验收待用户）。批次 4（远程基础）需求细化 + ADR-0010 进行中。**

| 选项 | 内容 | 后果 |
|---|---|---|
| **A（已选定）** | §3 五批次：提交 → 分支+标签 → stash → 远程基础 → merge/rebase+完整 pull | 与 docs/08 推荐序一致；风险递增排序 |
| B | A 基础上 fetch 提前至批次 2 并行 | 适配重度远程工作流；凭据 ADR 需提前定稿 |
| C | 用户按实际工作流自定义顺序 | 需用户给出具体序 |

裁决后：批次 1（提交创建与修改）先出需求细化 + ADR-0007 草案，再进入实现。