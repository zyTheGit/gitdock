# ADR 0027：Hunk 级暂存 / 取消暂存 / 丢弃

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`crates/git-core/src/dto/write.rs`（WriteKind、WriteRequest）、`crates/git-write`（新增 `hunk/{mod,gate,execute,patch,tests}.rs`，`command.rs`、`gate.rs`、`execute.rs`、`outcome.rs`、`staging.rs`）、`src/shared/types.ts`、`docs/03-技术架构.md`、`docs/adr/0002`（§3 边界注记）、前端暂存区（`StagingView` / `FileDiffView` / i18n，另行实现）
- 触发依据：任务 T07「Hunk 与行级暂存 / 取消暂存 / 丢弃」，修订 ADR-0002 §3「首期不做部分行暂存」中的既有边界

## 1. 背景

暂存区此前只支持整文件 stage / unstage / discard。一个文件里同时有本次功能代码、调试日志和另一项任务改动时，用户只能切到终端 `git add -p` 或 LazyGit。T07 要求把 Hunk 级（首期）能力收进应用内。

难点不在 `git apply` 本身，而在**补丁来源**：如果前端把拼好的 unified patch 文本传给后端执行，等于给跨进程 seam 开了一个「任意 patch 注入」通道——前端可以伪造文件路径、跨文件内容甚至 `.git` 内路径。因此本 ADR 的核心裁决是：**补丁只能由服务端从实时 diff 重新生成，前端只提供目标与序号**。

## 2. 决策

### 2.1 契约：三个 kind + `path` / `hunk_index`

`WriteKind` 新增 `stage_hunk` / `unstage_hunk` / `discard_hunk`，`WriteRequest` 新增两个字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `path` | `Option<String>` | 目标文件（仓库内相对路径）；其他操作忽略 |
| `hunk_index` | `Option<u32>` | 该文件 diff 中 0 起始的 hunk 序号；其他操作忽略 |

- 两个字段均 `#[serde(default, skip_serializing_if = "Option::is_none")]`，旧请求体结构不变、可继续反序列化；序列化仍是 snake_case。
- **一次请求只处理一个 hunk**，不做批量。理由：一个 hunk = 一次 Gate = 一次确认（丢弃还要一次破坏性确认）= 一条命令日志。批量会把「第 2 块成功、第 3 块失败」的语义塞进一个 outcome，并让 hunk_index 变成数组，得不偿失。
- 命令仍走 `validate_write` / `execute_write`，不新增 Tauri command：受限 DTO + Gate 已够用，多开入口违反「不给前端开通用 patch / 路径通道」。

### 2.2 补丁一律由服务端从实时 diff 重新生成

后端执行与 `staging_file_diff` → `tracked_diff` **完全相同的命令**，参数由 `staging::tracked_diff_args()` 单点给出：

```text
git diff --no-color --no-ext-diff --unified=3 -M [--cached] -- <path>
```

再把这份输出按字节切分为「文件头（首块 `@@` 之前的一切）+ hunk 列表」，只把**文件头 + 第 `hunk_index` 块**经 stdin 交给 `git apply`。

- **`hunk_index` 语义定死**：`read_staging_diff` 返回给 UI 的 patch 中第 N 个 `@@` 块就是 `hunk_index == N`（0 起始）。两边同源于一条命令、同一份输出，不存在「UI 数出来的块」与「后端数出来的块」错位。
- 前端不传 patch 文本、不传行号、不传 `staged` 之外的任何方向声明；`stage` / `unstage` / `discard` 由 `kind` 决定，路径性质由服务端按 status 判定。这同时免疫选项注入（`-`、`--exclude`）与跨文件注入——补丁里的路径永远来自本仓库此刻的 diff。
- 拆分按字节进行（`&[u8]`、只在 `\n` 上切行），不转 `String`：文件内容可能是任意编码，行尾可能是 `\r\n`，`\ No newline at end of file` 标记必须原样保留。
- 拆分后重组会再校验「结果恰好一块」，不满足直接拒绝（防御拆分错误把整文件补丁递出去）。

### 2.3 应用命令与作用面

| kind | 取 diff | `git apply` | 作用面 |
|---|---|---|---|
| `stage_hunk` | `git diff …`（index → worktree） | `git apply --cached -` | 只写索引 |
| `unstage_hunk` | `git diff --cached …`（HEAD → index） | `git apply --cached --reverse -` | 只写索引 |
| `discard_hunk` | `git diff …`（index → worktree） | `git apply --reverse -` | 只写工作区 |

- **不使用 `--unidiff-zero`**：我们保留标准 3 行上下文，补丁与 UI 看到的内容一一对应；零上下文会让行号漂移更难发现。
- 补丁只经 stdin（参数末位 `-`），不落盘、不进 shell；`GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` / `GIT_TERMINAL_PROMPT` 与其它写操作一致固定。
- `discard_hunk` 是**不经 reflog 的永久数据销毁**，必须走破坏性二次确认（见 2.4）。

### 2.4 Gate

bare 仓库与中断态由 `gate.rs` 前置拒绝（沿用既有规则）；hunk 专属校验在 `hunk/gate.rs`，按序执行、任何一条失败即拒绝：

1. 索引存在未解决冲突：`gate_conflicted_index_hunk`（冲突内容不做 hunk 级操作）。
2. `path` 必填（`gate_hunk_path_required`）；通过 `safe_rel_path` + `unsafe_path_shape`（绝对路径 / 盘符 / UNC / NUL / `-` 前缀）+ `.git` 首段拒绝。
3. 路径必须出现在当前 status（`gate_path_not_in_status`）；冲突条目 `gate_conflicted_file`。
4. 未跟踪 → `gate_hunk_untracked`（没有 index 基准，提示整文件暂存）；重命名 / 复制 → `gate_hunk_rename`。
5. 对应侧必须真有改动：stage/discard 看 worktree 侧（`gate_nothing_to_stage` / `gate_nothing_to_discard`），unstage 看 index 侧（`gate_nothing_to_unstage`）。
6. 最后才跑实时 diff：二进制 → `gate_hunk_binary`，gitlink → `gate_hunk_gitlink`，无文本 hunk → `gate_hunk_no_changes`。
7. `hunk_index` 必填（`gate_hunk_index_required`），且必须 `< 实时 diff 的块数`，否则 `gate_hunk_index_out_of_range`（args 带 `index` 与 `total` 当前块数）——**并发漂移就在这里挡住**，不会把补丁打歪。
8. `discard_hunk` 的 Gate 额外返回 `hunk_discard_destructive` warning，并给出 `affected_paths = [path]`、`affected_total = 1`，确认框据此标红。

### 2.5 执行

`execute_write` 在 Gate 通过后委托 `hunk/execute.rs`：重新生成 diff → 重新切块 → 复查序号（Gate 与执行之间仍可能被外部改动）→ 跑对应 `git apply`。

- 非零退出映射为 `ErrorCode::GitCommandFailed`，`detail = stderr`，key `errors.hunkApplyFailed`——与「Gate 拒绝」区分开：用户看到的是「Git 拒绝了这条补丁，刷新后重试」，而不是静默成功。
- 成功文案复用 `outcome.rs::success_message`（新增三个 kind 的条目），保持与其它写操作一致的结果结构与写后刷新语义（generation 由 command 层注入）。

### 2.6 用户可见文案的 key

Rust 只给 key 与中文兜底文案，翻译由前端 agent 补（`errors` 命名空间；issue / warning 的 snake_case code 对应 camelCase key）：

| 类别 | key |
|---|---|
| issue | `errors.gateHunkPathRequired`、`errors.gateHunkIndexRequired`、`errors.gateHunkUntracked`、`errors.gateHunkBinary`、`errors.gateHunkGitlink`、`errors.gateHunkRename`、`errors.gateHunkNoChanges`、`errors.gateHunkIndexOutOfRange`、`errors.gateConflictedIndexHunk` |
| warning | `errors.hunkDiscardDestructive` |
| 错误 | `errors.hunkNoChanges`、`errors.hunkIndexOutOfRange`、`errors.hunkIndexRequired`、`errors.hunkPathRequired`、`errors.hunkUntrackedNotSupported`、`errors.hunkBinaryNotSupported`、`errors.hunkApplyFailed`、`errors.hunkDiffFailed`、`errors.hunkKindInvalid` |
| 结果 | `errors.outcomeHunkStaged`、`errors.outcomeHunkUnstaged`、`errors.outcomeHunkDiscarded` |
| 摘要 | `errors.gateSummaryHunkStage`、`errors.gateSummaryHunkUnstage`、`errors.gateSummaryHunkDiscard` |

issue 复用既有条目的部分（`gate_invalid_path`、`gate_git_dir_path`、`gate_path_not_in_status`、`gate_conflicted_file`、`gate_nothing_to_stage` / `unstage` / `discard`）不再新增翻译。

### 2.7 范围外（明确不做）

| 项 | 原因 |
|---|---|
| 行级暂存（选中若干行） | 二期；需要行号级选择模型与「部分行 patch」构造，收益低于风险 |
| 未跟踪文件 | 无 index 基准，`git apply --cached` 无从对齐；提示整文件暂存 |
| 二进制文件 | 无文本 hunk 可拆 |
| 重命名 / 权限（mode）变更 | 补丁头是模式/路径变更而非 hunk；整文件操作已覆盖 |
| 子模块 gitlink | index 存提交指针，不适用文本补丁 |
| 冲突索引 | 冲突内容需要先解决，不允许在冲突态做 hunk 操作 |
| 中断态 / bare 仓库 | 沿用既有写操作边界 |

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 前端把 unified patch 文本传后端执行 | 打开任意 patch 注入通道：可伪造路径、跨文件、写 `.git`；与「跨进程只走受限 DTO」冲突 |
| 前端传行号区间（selected_lines）由后端拼补丁 | 行号与上下文行数仍需后端解释，且与块序号语义重复；首期没有行级 UI |
| `git apply --unidiff-zero` + 纯行号补丁 | 零上下文对行号漂移零容忍，UI 侧一行差异就会把补丁打歪；标准上下文更稳 |
| `git add -p` / `git checkout -p` 交互式 | 需要 PTY 交互与 stdin 对话，无法收敛为「一个请求一条命令」，也难审计 |
| 一个请求批量处理多个 hunk | 需要批量 Gate、批量确认与部分失败语义，与「一次确认一个动作」的安全模型冲突 |
| 新增专用 Tauri command | 通用 validate/execute seam 已能表达（受限 DTO + Gate），多开入口只会多一个待审计通道 |

## 4. 后果

- `WriteKind` 增至 31 项，`src/shared/types.ts` 同步；hunk 操作与其它写操作共享同一把仓库写锁与命令日志。
- `git-write` 新增 `hunk/` 模块（`mod.rs` 定 side 与共享 helper、`gate.rs` 校验、`execute.rs` 执行、`patch.rs` 纯拆分/重组函数、`tests.rs` 单元测试）；`gate.rs` 只多一个分派分支，行数不增。
- `staging.rs` 抽出 `tracked_diff_args()`，`staging_file_diff` 与 hunk 走同一条 diff 命令——改这条命令等于同时改 hunk 契约（代码注释已标明）。
- 每个 hunk 请求多跑一次 diff（与 UI 刚拿到的是同一条命令，成本可接受）；补丁不落盘。
- 用户可见的 hunk 序号是 1 起始（文案「第 n 块」），协议里的 `hunk_index` 是 0 起始；两者只在文案层转换。

## 5. 验收

1. 已跟踪文件有 3 个独立 hunk：只暂存 `hunk_index = 1`，索引只含第 2 块，工作区内容与其余 hunk 不变。
2. 全量暂存的多 hunk 文件：只取消暂存 `hunk_index = 1`，该块退回工作区，其余块仍在索引。
3. 只丢弃 `hunk_index = 1`：仅有该块从工作区还原，其余 hunk 与已暂存内容保留；Gate 给出 `hunk_discard_destructive` 与 `affected_total = 1`。
4. 文件末尾缺少换行（`\ No newline at end of file`）：暂存 / 取消暂存后字节精确无损坏。
5. `hunk_index` 越界、看 diff 期间块数漂移、未跟踪 / 二进制 / 冲突索引 / 中断态 / 非法路径：Gate 拒绝且工作区零改动。
6. `cargo test -p git-write`、`cargo clippy -p git-write -p git-core -p gitdock-app --all-targets -- -D warnings`、`cargo fmt --all -- --check`、`npx tsc --noEmit`、`node scripts/check-ipc-args.mjs` 全绿；触及文件 ≤ 600 行（新增 ≤ 400 行）。
