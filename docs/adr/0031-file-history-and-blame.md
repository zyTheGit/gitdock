# ADR 0031：单文件提交历史与行级追溯（Blame）

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`git-core`（新增 `dto/history.rs` 与 re-export）、`git-read`（`read/file_history.rs`、`read/file_blame.rs`、`read/mod.rs` 注册）、`src-tauri`（`app/commands/read.rs`、`lib.rs` 注册）、前端契约 `src/shared/types.ts`（由前端任务补齐）
- 触发依据：`docs/tasks/T11-单文件历史与GitBlame追溯.md`；`docs/13` 为 T06–T12 预留 ADR 0026–0034，本任务对应 0031

## 1. 背景

排查线上问题或理解历史设计时，需要两件能力：

1. **单文件提交历史**：某路径在时间线上被哪些提交改过，可连续翻页；
2. **行级追溯（Blame）**：文件每一行最后一次由哪个提交写入，可跳回该提交。

两者都是只读查询，但都需要按路径反复读取历史树/历史 blob。现有能力只有路径搜索（最多回扫 2000 条提交，且按「任一变更路径包含关键词」匹配），既不针对单文件收敛，也不返回逐行归属。

约束：

- `git-read` 只允许 gix + 只读，禁止子进程（`git log --follow` / `git blame` 不可用）与写盘；
- 跨进程只走受限 Tauri command，返回 `Result<Dto, UserVisibleError>`；
- 分页必须是不透明 cursor（禁止 offset）；
- 单文件 ≤ 600 行，新文件 ≤ 400 行。

## 2. 决策

### 2.1 契约（`git_core::dto::history`）

| DTO | 字段 | 说明 |
|---|---|---|
| `FileHistoryEntryDto` | `commit: CommitSummaryDto`、`status: FileStatus`、`old_path: Option<String>` | 首版不追踪重命名，`old_path` 恒为 `None` |
| `FileHistoryPageDto` | `generation: u64`、`path`、`entries`、`next_cursor`、`has_more` | cursor 复用 `git-core::cursor` |
| `BlameLineDto` | `line_no: u32`（1 起）、`oid`、`short_oid`、`author_name`、`authored_at`（Unix 秒）、`summary`、`content` | `content` 不含行尾换行符 |
| `FileBlameDto` | `generation`、`oid`、`path`、`lines`、`binary`、`too_large`、`encoding_fallback`、`language` | 降级时 `lines` 为空数组，不用错误码打断 UI |

序列化风格与既有 DTO 一致：字段名 snake_case 原样输出，可选字段 `#[serde(skip_serializing_if = "Option::is_none")]`，`Oid` 以字符串输出。

### 2.2 单文件历史：按树条目 OID 剪枝

不逐提交做内容 diff，而是比较**目标路径在两棵树中的条目（blob/tree OID + mode）**：

1. 先按 `scope` 建/复用拓扑索引 `GraphIndex`（`head` / `all` / 分支名 / 显式 commit），保证提交顺序与图谱一致且可分页；
2. 对索引中的每个提交，取它和**第一父**的树，沿路径逐级查条目；条目 OID 与 mode 都不变则跳过，不读 blob 内容；
3. 判定 `status`：父无/子有 → `Added`，父有/子无 → `Deleted`，两侧 OID 不同 → `Modified`，OID 相同但 mode 变化（如 文件↔符号链接）→ `TypeChanged`；
4. 根提交与空树比较，必然产出 `Added`。

**merge 规则**：只与第一父比较。合并本身若未改动该文件（blob 与第一父相同）不产出条目；若合并解决冲突时改动过该文件，条目归属该 merge commit —— 与 `CommitDetailDto` 的 `DiffBaselineDto::MergeFirstParent` 语义一致。侧支上各自的改动会由侧支提交自身产出，因此不会丢失，但同一改动可能在大仓历史上出现两次（侧支一次、合并再次以第一父视角呈现）——首版接受该重复。

**重命名**：首版只追踪当前路径，重命名后历史在新路径处重新开始（旧路径一侧显示为 `Deleted`）。`old_path` 保留字段以便后续做 follow 启发式而不改契约。

### 2.3 分页与游标

- `view_key`：`head` / `all` / `branch:<name>` 与图谱一致；显式 commit 起点用 `commit:<oid>`（独立索引缓存键，避免与图谱视图串用）。
- cursor 载荷沿用 `CursorData { v, view_key, generation, after }`，`after` = 本页**最后处理过**的提交 OID（可能是未被发出的提交，因为无关提交要跳过）。
- 校验顺序：base64/JSON 非法 → `CursorInvalid`；`generation` 不符或 `after` 不在索引中 → `CursorStale`；`view_key` 不符 → `CursorInvalid`。
- 单次最多扫描 `MAX_SCAN = 20_000` 个提交，防止「文件很久没改」时一次请求扫穿全库；扫到上限时返回 `has_more = true` 与最后处理 OID，下一页继续。

### 2.4 起点参数 `oid_or_scope`

command 只接收一个字符串（可缺省），`git-read` 内解析：

| 输入 | 语义 |
|---|---|
| 缺省 / 空 / `head` | 当前 HEAD 可达提交 |
| `all` | 全部 refs |
| 40 或 64 位十六进制 | 从该 commit 起（含）的祖先历史 |
| 其他 | 按分支/tag/远程分支名解析（`refs/heads`、`refs/remotes`、`refs/tags`） |

解析放在 `git-read` 而非 app 层：只有该 crate 了解 refs 布局与 OID 格式。

### 2.5 Blame：自研逐行归因（不用 `gix::Repository::blame_file`）

gix 0.90 **提供** `Repository::blame_file`，但：

1. 它由 `blame` feature 提供，需新增可选依赖 `gix-blame 0.20`（当前依赖集未包含，且该 crate 标注为实验性接口）；
2. 其 `Outcome` 面向 hunk 与 rename 重写跟踪，需要额外的 `Rewrites`/`BlameRanges` 配置与结果展开，首版收益不明显；
3. 引入新依赖会改变 workspace 依赖图与构建体积，属于需要单独评审的变更。

因此首版用纯 gix + `similar` 实现等效算法（标准 blame 的回溯形式）：

1. 读取目标提交在该路径的 blob；超过 `MAX_DIFF_BYTES` → `too_large`，含 NUL 前 8KB → `binary`，非 UTF-8 → `encoding_fallback`（复用 `decode_text`）；gitlink 按 `binary` 处理；
2. 目标文本按行建立待定行集合，初始全部未归属；
3. 沿**第一父链**回溯：设当前提交 Ci、父 C{i+1}；若两侧 blob OID 相同，全部待定行原样传给父（不跑 diff）；否则 `TextDiff::from_slices(父行, 当前行)`，`Equal` 块把「当前行号 → 父行号」映射过去，未被映射的待定行归属 Ci（该行在 Ci 中最后一次被改动）；
4. 走到根提交、父提交中没有该路径、父 blob 超限/二进制，或达到 `MAX_BLAME_COMMITS = 4096` 时，剩余待定行归属当前处理到的提交并结束；
5. 每个归属提交通过 `commit_summary` 取 `author_name` / `authored_at` / `summary` / `short_oid`；`line_no` 从 1 起，`content` 用 `str::lines()`（去掉行尾 `\n`/`\r\n`）。

限制（首版接受并写进验收说明）：不做跨重命名跟随；不跨 merge 侧支（与 `git blame` 的默认首父行为一致）；重复行可能被 diff 对齐到较早的出现位置，属启发式差异；超过上限的历史段归到边界提交。

### 2.6 跨进程 seam

```text
read_file_history(state, path, oid_or_scope?, cursor?, limit?) -> FileHistoryPageDto
read_file_blame(state, oid, path) -> FileBlameDto
```

`limit` 缺省 `DEFAULT_PAGE_LIMIT`，并 clamp 到 `[1, MAX_PAGE_LIMIT]`；两个 command 都走 `state.with_session` + `blocking`，与既有读 command 一致；`src-tauri` 不做 Git 解析，仅转发参数与解析 OID。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| `git log --follow -- path` / `git blame` 子进程 | `git-read` 只读静态守卫禁止子进程；且违反「Git 知识各归一处」 |
| 启用 gix `blame` feature + `gix-blame` | 新增实验性依赖，改变依赖图与构建成本，先自研等效算法 |
| 逐提交全树 diff 求历史 | 每提交解析整棵树与 blob，成本高一个量级；按路径条目 OID 剪枝即可 |
| offset 分页 | cursor 必须不透明，refs 变化后旧游标要立即失效 |
| 历史跟随重命名（`--follow` 启发式） | 相似度判定成本与误判都高，首版限定当前路径 |

## 4. 后果

- `git-core` 增加 `history` DTO 模块；`git-read` 增加两个只读模块并纳入只读静态审计清单（源码不得出现子进程/写盘）。
- 单文件历史首次请求需要建/读拓扑索引；后续分页命中索引缓存。Blame 成本与「历史长度 × 文件行数」相关，受 4096 提交与 2MB 上限保护。
- 重命名、跨侧支归属的已知差异需要在 UI 提示（前端任务负责文案）。
- 契约新增两个 `Option` 字段语义（`old_path`、`language`），前端按 DTO 原样使用即可。

## 5. 验收

1. 线性仓库中夹带无关提交时，单文件历史只返回改动过该路径的提交，且顺序与图谱拓扑序一致。
2. 用 cursor 连续翻页无重复、无遗漏；`generation` 变化后旧 cursor 返回 `CursorStale`。
3. Blame 对三批提交写入的不同行分别归属到对应提交，行号连续、内容与工作副本一致。
4. 二进制/超大文件不读入内存生成行数据，返回 `binary` / `too_large` 且 `lines` 为空。
5. `v2_readonly` 静态与运行时守卫通过；`cargo clippy -D warnings`、`cargo fmt --check` 全绿。
