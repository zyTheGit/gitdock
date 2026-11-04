# ADR 0007：提交创建与 amend——消息文件传递与历史改写确认

- 状态：草案（待产品确认后进入实现）
- 日期：2026-11-04
- 影响范围：`crates/git-core/src/dto.rs`（WriteKind / WriteRequest）、`crates/git-write/src/command.rs`、`crates/git-write/src/commit_gate.rs`（新增）、`crates/git-write/src/commit.rs`（新增，测试拆 `commit/tests.rs`）、`src-tauri` command 装配、`src/shared/types.ts`、`src/features/staging/`（提交入口与消息对话框）、`docs/03-技术架构.md`
- 触发依据：docs/06 N5（暂存区含提交闭环）、docs/11 批次 1（2026-11-04 用户裁决五批次序）；WriteKind 白名单现无提交能力

## 1. 背景

暂存区视图已交付 staged/unstaged 状态与 diff、stage/unstage（阶段 C），但「提交」环节缺失——用户暂存后仍需到终端执行 `git commit`，N5 的暂存区闭环只差最后一环。docs/08 G6 完成标准要求：每个操作在 GitWriteModule 白名单内、成功/失败/冲突/中断状态清晰、工作区与 refs 实际状态经独立测试验证。

## 2. 决策

### 2.1 白名单与命令构造

`WriteKind` 新增 `CreateCommit`、`AmendCommit`。命令构造：

- 创建：`git commit --file=<临时文件>`
- 修改：`git commit --amend --file=<临时文件>`

消息经临时文件传递：消息正文含换行、引号、以 `-` 开头的内容时，`-m` 直传有语义压缩与选项注入风险；`--file` 让 Git 自行读取文件内容，参数数组不经 shell 的既有规则不变。临时文件由 execute 在系统临时目录创建（随机文件名）、无论成败结束时删除；消息内容不进应用日志。

不携带 `--allow-empty`（空提交需求未获产品确认）、`--allow-empty-message`（Gate 拒绝空消息）、`--no-verify`（hooks 必须执行，不静默绕过用户钩子）。

### 2.2 Gate 校验拆到 commit_gate.rs

gate.rs 已 527 行（逼近 600 硬上限），提交校验按场景拆独立模块 `commit_gate.rs`，gate.rs 只做分发，不顺手重构既有逻辑。校验规则：

| 规则 | create | amend | issue code |
|---|---|---|---|
| 暂存区为空 | 拒绝 | 允许（只改消息） | gate_nothing_to_commit |
| 消息空/仅空白 | 拒绝 | 拒绝 | gate_empty_message |
| 中断态 | 拒绝 | 拒绝 | 复用 gate_interrupted |
| 冲突索引 | 拒绝 | 拒绝 | 复用既有冲突语义 |
| unborn HEAD | 允许（首次提交） | 拒绝 | gate_unborn_head_amend |
| bare 仓库 | 拒绝 | 拒绝 | 复用 gate_bare_repository |

### 2.3 确认语义：create 直执、amend 专门确认

- CreateCommit 不走 ConfirmWriteDialog：消息表单本身就是显式意图（与 stage/unstage 直执同模式），Gate 拒绝项在对话框内就地展示。
- AmendCommit 是历史改写，必须专门确认：确认框展示将被替换的 HEAD 提交（短 oid + 主题）与「提交标识会改变」说明，并给出恢复路径（`git reflog` + `git reset --hard HEAD@{1}` 指引文案）。amend 预填当前消息经读路径获取：git-read 扩展 `read_head_message`（`git log -1 --pretty=%B` 形态）；读路径归 git-read 的既有规则不变。

### 2.4 DTO 与前端流

- `WriteRequest` 增 `message: Option<String>`（git-core dto.rs 与 src/shared/types.ts 同步，契约集中规则）。
- StagingView 增提交按钮（staged 非空且无冲突时可用），打开 CommitMessageDialog（消息 textarea、trim 校验、amend 切换）；执行复用既有 validate_write / execute_write IPC 与 write_lock 互斥；写后刷新走既有 readSnapshot / reload + RefreshCoordinator generation 流。
- outcome 文案复用 key+args 机制（承载新提交短 oid）。

## 3. 备选方案（未采纳）

| 方案 | 行为 | 不采纳原因 |
|---|---|---|
| `git commit -m <消息>` 直传 | 消息作单参数 | 换行被压缩的语义差；引号/`-` 开头内容的注入风险；多段 `-m` 拼接规则隐晦 |
| 支持 `--allow-empty` | 允许空提交 | 产品未确认需求；Gate 先拒绝，后续有诉求再扩展 |
| 提供 `--no-verify` 开关 | 可跳过 hooks | 静默绕过用户自设钩子违背安全边界；需要时用户可到内置终端执行 |
| 复用 useWriteFlow 的 prompt 流 | 提交也走确认框 | 提交是表单流不是目标选择流；普通提交再弹确认框是无收益的重复确认 |
| amend 校验留在 gate.rs | 不拆模块 | gate.rs 已 527 行逼近硬上限；新校验按场景拆模块是 docs/11 §4 既定约束 |

## 4. 后果

- WriteKind 8→10；git-write 新增 commit.rs / commit_gate.rs（测试独立分文件，单文件按 ≤400 行规划）；前端新增 CommitMessageDialog 与 staging 域 i18n key（zh/en 同步，check-i18n 门禁覆盖）。
- N5 暂存区闭环补齐（查看 → 暂存 → 提交）。
- 行为边界：amend 时 author 不变、committer 更新（Git 默认语义，不额外传 `--reset-author`）。

## 5. 验收清单（实现完成的判定）

1. 新仓库（unborn HEAD）：staged 文件 + 消息 → 提交成功，独立 `git log --oneline -1` 核对消息与文件内容。
2. 空暂存 create、空消息、中断态、冲突索引：全部拒绝并展示对应 issue code 文案。
3. amend 仅改消息：树内容不变（独立 diff 核对）、committer 信息更新、旧提交经 reflog 可恢复（指引文案可操作）。
4. amend 带暂存变更：`git show HEAD` 独立核对内容与消息。
5. pre-commit hook（exit 1 + stderr）：提交失败、HEAD 未变、stderr 展示。
6. 临时消息文件执行后不残留。
7. `npm run check`（含 cargo test --workspace 与 check-i18n）全绿；触及文件行数合规。