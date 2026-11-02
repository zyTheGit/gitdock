# ADR 0001：冲突继续/中止与 merge 父选择

- 状态：已接受（2026-11-02 确认第 6 节四项语义，并按第 7 节实测修正）
- 日期：2026-10-28
- 影响范围：`git-write` 写白名单、写前 Gate、执行状态机、F7 前端横幅、需求与任务文档
- 触发依据：`docs/01-需求冻结.md` 变更控制——凡是触及 Git 写入边界的变化，必须先形成 ADR

## 1. 背景

MVP 的写操作白名单只有 cherry-pick、revert、切换本地分支、写分支描述。冲突发生后应用只提示终端接管：

- 不提供【继续】【中止】按钮；
- 不自动 `--abort` / `--quit`；
- merge commit 直接拒绝，提示命令行用 `-m`。

这带来两个闭环缺口：

1. 用户在应用内发起 cherry-pick / revert 后发生冲突，必须离开应用在终端收尾，图谱状态与用户心智断开。
2. merge commit 无法在应用内 pick / revert，而这正是需要人工选择基线父提交的高风险场景。

需求文档第 4 节已将「冲突【继续】【中止】」「merge commit 父选择（-m）」列入 P1。本 ADR 定义这两个能力的写入边界、Gate 规则、状态机扩展与验收口径，避免直接改代码造成边界漂移。

## 2. 决策

### 2.1 冲突继续/中止：只在中断态存在时开放，且必须显式触发

新增写操作：

| kind | 前置条件 | 命令（参数数组，经 Git CLI） |
|---|---|---|
| `continue_operation` | 存在且仅存在本次对应的 `CHERRY_PICK_HEAD` 或 `REVERT_HEAD`；`sequencer`、`MERGE_HEAD`、`REBASE_HEAD`、`rebase-merge`、`rebase-apply`、`index.lock` 均不存在；无未解决冲突（`status.conflicted == 0`） | `GIT_EDITOR=true git cherry-pick --continue` 或 `GIT_EDITOR=true git revert --continue` |
| `abort_operation` | 存在且仅存在本次对应的 `CHERRY_PICK_HEAD` 或 `REVERT_HEAD`；其余中断标记与 `index.lock` 均不存在 | `git cherry-pick --abort` 或 `git revert --abort` |

规则：

- **绝不自动调用**：继续/中止只能由用户点击并确认后执行；启动恢复横幅仍然只展示只读信息与终端提示，不出现自动动作。
- `WriteRequest` 增加 `interruption: Option<InterruptionKind>`，取值仅允许 `cherry_pick` / `revert`。Gate 要求请求的 kind 与探测到的标记严格一致，避免在 rebase / merge / sequencer 状态下误触发。
- 单次 cherry-pick / revert **不会**创建 `sequencer`；一旦 `sequencer` 与对应标记并存即为多提交序列，必须拒绝并提示终端接管。首个版本不接管批量序列。
- 中止属于破坏性操作：确认框必须明确说明「将回到操作开始前的状态，已手工解决的冲突内容会丢失」，且按钮文案为「中止并丢弃冲突解决」。这是本 ADR 中唯一新增的破坏性写入口。
- 继续在仍有未解决冲突时直接拒绝（Gate 就绪性检查），不依赖 git 的报错文本；用户解决冲突并 `git add` 后可重试。
- 继续时若 Git 判定结果为空提交，`cherry-pick --continue` 会以非零退出并保留 `CHERRY_PICK_HEAD`。应用按「失败 + 终端提示」展示，提示 `git cherry-pick --skip` 或 `git revert --skip`，**不自动 skip**。

### 2.2 merge commit 父选择：显式 mainline，禁止猜测

- `WriteRequest` 增加 `mainline: Option<u32>`，取值为 1 起始的父序号。
- Gate 规则：
  - 非 merge commit：提供 `mainline` → 拒绝（`mainline_not_applicable`），避免静默忽略。
  - merge commit：未提供 `mainline` → 拒绝（`mainline_required`），保留 MVP 的「不猜测」语义；提供但小于 1 或大于父数量 → 拒绝（`mainline_invalid`）。
  - merge commit 仍要求工作区干净、非 detached、非 unborn、无中断态。
- 命令：`git cherry-pick -m N <oid>`、`git revert -m N --no-edit <oid>`。
- Gate 摘要必须写明「以第 N 父提交为基线（N/M）」，确认框原样展示。
- 前端：Gate 返回 `is_merge_commit` 与父提交列表（新增 `parents` 摘要字段或复用详情接口）；用户先选父提交再确认。首版默认选中第 1 父，但必须允许改选。

### 2.3 状态机与结果判定：沿用退出码 + 操作态复探

- 不新增 `WriteStatus` 枚举值：继续/中止成功复用 `Succeeded`；Gate 拒绝复用 `Rejected`；继续仍有冲突、空提交、hook 拒绝等复用 `Failed`（带 stderr 与终端提示）。
- 结果判定保持现有原则：**退出码 + 执行后重新探测操作态**，不解析输出文本。
  - 继续：退出码 0 且对应标记消失 → 成功；标记仍在 → 失败/未完成。
  - 中止：退出码 0 且对应标记消失 → 成功；否则失败。
- 失败诊断只把 stderr 当作附加信息：revert 的空结果继续可能没有任何 stderr，应用必须合成可读提示并附对应 `--skip` 终端命令。
- 成功后与现有写操作一致：发布新的 generation、刷新图谱、刷新横幅；`generation` 由应用层统一注入（与现状一致）。

### 2.4 不变量（不因本 ADR 放宽）

- 所有写命令：参数数组、不经 shell、不拼接用户输入。
- 所有状态路径：`git rev-parse --git-path`；不直接访问 `.git` 内部路径。
- 前端不执行命令、不解析 Git 对象、不感知路径探测细节。
- 不自动 `--abort` / `--quit` / `--skip`。
- rebase、merge、批量 cherry-pick 的 continue/abort 不纳入本 ADR。
- 仍不提供冲突解决 UI（三栏合并）；冲突内容仍在外部编辑器/终端处理。

## 3. 需求与验收补充（提议）

在 `需求文档.md` F7 增补：

| 编号 | Given / When / Then |
|---|---|
| F7-6 | Given cherry-pick 冲突且用户已解决并 `git add` When 点击【继续】 Then 成功完成并刷新图谱，横幅消失 |
| F7-7 | Given 仍有未解决冲突 When 点击【继续】 Then 拒绝并提示先解决冲突，不执行 git 命令 |
| F7-8 | Given 冲突横幅 When 点击【中止】并二次确认 Then 回到操作前状态，标记消失；未确认则不执行 |
| F7-9 | Given 多提交序列或 rebase/merge 中断态 When 查看横幅 Then 只显示终端提示，不出现【继续】【中止】 |
| F7-10 | Given merge commit When 选择第 N 父提交并确认 Then 以 `-m N` 执行，Gate 摘要标明基线父 |
| F7-11 | Given merge commit 未选择父提交 When 执行 Then 拒绝并提示必须选择 |
| F7-12 | Given 继续后 Git 判定为空提交 When 执行 Then 展示失败与 `--skip` 终端提示，不自动 skip |

## 4. 任务拆分（提议）

| 任务 | 内容 | 依赖 |
|---|---|---|
| P1-W1 | `git-core`：`WriteKind` 增加两个变体，`WriteRequest` 增加 `interruption` / `mainline`，序列化兼容旧请求（缺省 None） | — |
| P1-W2 | `git-write`：Gate 规则、`command_for` 参数构造、结果判定、单测（冲突继续/中止、未解决冲突拒绝、序列态拒绝、merge 父选择合法/非法） | W1 |
| P1-W3 | `src-tauri`：IPC 透传与日志；不需要新增 command | W2 |
| P1-W4 | 前端：横幅按钮、二次确认文案、merge 父选择控件、失败提示 | W2 |
| P1-W5 | 文档：需求 F7 增补、任务拆分更新、交接文档限制项移除 | W1–W4 |

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 中止丢弃用户已解决的冲突内容 | 二次确认 + 明确文案；只在用户点击后执行 |
| 在终端发起的多提交序列中被误操作 | `sequencer` 存在即拒绝；仅接管单次 cherry-pick / revert |
| 继续时编辑器阻塞 | Git 2.53 实测 `--continue` 不启动编辑器；仍保留 `GIT_EDITOR=true` / `GIT_SEQUENCE_EDITOR=true` 作为防御 |
| merge 父序号选错导致反向内容 | 确认框展示父提交短 OID + 摘要；默认第 1 父，不改用猜测 |
| 继续/中止后 index 状态异常 | 执行后重新探测中断态与工作区状态；失败时保留 stderr 供诊断 |

## 6. 决策结果（2026-11-02）

1. merge commit 开放任意合法父序号 `1..=parent_count`，UI 默认第 1 父，必须允许改选；不采用“首版仅 `-m 1`”。
2. 中止采用二次确认弹窗 + 明确的破坏性按钮文案「中止并丢弃冲突解决」，不要求输入分支名，也不额外增加勾选框。
3. 允许对终端发起的单次 cherry-pick / revert 冲突使用应用内继续/中止；判定只看标记严格匹配与其它中断标记不存在，不记录操作发起方。
4. 空结果继续失败后首版不提供【跳过】按钮，只展示应用合成的失败说明与对应 `--skip` 终端命令。

## 7. 实测依据（Git 2.53，Windows）

| 场景 | 观测结果 |
|---|---|
| 单次 `cherry-pick` / `revert` 冲突 | 只有 `CHERRY_PICK_HEAD` / `REVERT_HEAD`，**没有** `sequencer/` |
| `cherry-pick A B` 序列冲突 | 标记与 `sequencer/` 同时存在 |
| `merge` / `rebase` 冲突 | `MERGE_HEAD` / `REBASE_HEAD` + `rebase-merge/` 或 `rebase-apply/` |
| 仍有未解决冲突时 `--continue` | 退出码 128，标记保留 |
| 解决为空结果后 `--continue` | 退出码 1，标记保留；cherry-pick 的 stderr 有 `--skip` 提示，**revert 可能没有 stderr**（提示在 stdout） |
| `-m` 父序号 | `1` 起始，与 `cat-file -p` / `rev-list --parents` 顺序一致；越界退出 128，`-m 0` 退出 129 |
| 非 merge commit 加 `-m 1` | Git 静默接受，因此必须由 Gate 拒绝 `mainline_not_applicable` |
| `--continue` 的编辑器 | Git 2.53 不启动编辑器；`GIT_EDITOR=true` 保留为防御 |

补充边界：现有实现会在**应用发起的首次空 pick**、且工作区/索引干净时自动执行 `--skip` 清理；本 ADR 的“不自动 skip”针对继续/中止路径，两者不冲突。该既有行为保持不变，并在代码注释中说明适用范围。
