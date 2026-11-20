# ADR 0030：Stash 内容预览、工作区对比与 diff 选项

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`git-core`（新增 `dto/stash.rs`、`image.rs`，扩展 `dto/diff.rs`、`dto/compare.rs`）、`git-read`（`read/stash.rs` 扩展、新增 `read/worktree_compare.rs`、`diff/unified.rs`、`diff/patch.rs` 重构）、`git-write`（`staging.rs` 展示参数）、`src-tauri`（`app/commands/{read,write}.rs`、`lib.rs`）、前端契约 `src/shared/types.ts`（由前端任务补齐）
- 触发依据：`docs/tasks/T10-Stash内容预览与工作区对比.md`；`docs/13` 为 T06–T12 预留 ADR 0026–0034，本任务对应 0030

## 1. 背景

现有能力缺口有三处：

1. stash 只能列出条目（`read_stashes`），看不到某条 stash 改了什么；
2. 对比双槽只接受两个提交，无法把当前工作区（未提交改动）当作一端；
3. diff 只能按原始文本展示，空白噪音与图片无法处理。

约束：`git-read` 只读（不得子进程、不得写盘、必须通过只读静态审计）；跨进程只走受限 command；契约集中在 `git-core`；不新增写操作种类（`WriteKind` 仍为 36 项）。

## 2. 决策

### 2.1 契约（`git_core`）

| DTO / 字段 | 说明 |
|---|---|
| `StashDetailDto { generation, oid, files: Vec<ChangedFileDto>, truncated, includes_untracked, warnings }` | `files` 复用既有文件条目 DTO，不再引入 stash 专用文件类型 |
| `FileDiffDto.image_before` / `image_after` / `image_kind` | 可选图片预览（data URI / 小写后缀），缺省不序列化 |
| `CompareMode::Worktree` | 工作区对比的显式模式，与 `three_dot` / `two_dot` / `two_dot_fallback` 并列 |
| `CompareResultDto.worktree_side: Option<WorktreeSide>` | `base` / `compare`；缺失表示普通提交对比 |

序列化风格与既有 DTO 一致：snake_case 原样输出，可选字段 `skip_serializing_if = "Option::is_none"`，`Oid` 以字符串输出。

### 2.2 Stash 快照的三个父提交

stash 提交不是普通提交，按父顺序解释：

| 父 | 内容 | 本 ADR 里的用途 |
|---|---|---|
| 第 1 父 | stash 之前的 HEAD | 作为 tracked 改动的旧侧树 |
| 第 2 父 | 创建 stash 时的索引树 | 首版不单独展示（见 §2.3） |
| 第 3 父 | 仅 `stash -u` 时存在，未跟踪文件树 | 未跟踪文件清单与 diff 来源 |

`read_stash_detail(oid)`：

1. tracked 改动 = 第 1 父树 ↔ stash 提交树（stash 提交树即 stash 时刻工作区快照）；
2. 第 3 父存在时，其全部条目作为 `Added` 追加（旧侧为空树，无内容 diff）；
3. 按路径用 `BTreeMap` 合并去重，先到的 tracked 条目优先（未跟踪文件不会与第 1 父路径重叠）；
4. 文件数上限 `MAX_STASH_FILES = 2000`，超限截断并给出 `stash_files_truncated` warning；`includes_untracked = 第 3 父存在`；
5. 没有父提交的提交直接拒绝：`InvalidArgument` + `errors.readNotAStashCommit`。

`read_stash_file_diff(oid, path, ignore_whitespace?)`：先按 tracked 侧生成 `FileDiffDto`；仅当返回 `FileNotFound` 且存在第 3 父时，改用「空树 ↔ 第 3 父树」取该路径。图片预览与 2MB / 5000 行降级沿用统一 `diff_content`。

### 2.3 未采纳：单独展示 index 侧改动

第 2 父能让 UI 区分「已暂存 / 未暂存」两段，但 stash 条目本身不记录二者的展示语义差异（apply 后两段会重新合并），且现有 `StagingStatusDto` 已承担暂存区分。首版不展示第 2 父，避免同一 stash 出现三份文件清单。

### 2.4 工作区对比：`worktree` 保留字 + 只读快照

两端参数都接受字符串，`git-read` 解释保留字 `worktree`（`is_worktree_ref`），app 层只转发：

```text
compare_commits(base, compare_oid, path_filter?, two_dot) -> CompareResultDto
compare_file_diff(base, compare_oid, path, two_dot, ignore_whitespace?) -> FileDiffDto
```

- 两侧都是 `worktree` → `InvalidArgument` + `errors.readWorktreeBothSides`；
- 工作区没有历史，`two_dot` 被忽略；
- `merge_base = None`、`base_only = compare_only = 0`、`commits` 为空、标题为「<short> → 工作区」或「工作区 → <short>」；
- `mode = Worktree`，`worktree_side` 指出工作区落在哪一侧；
- `base` / `compare` 保持 `Oid` 类型不破坏前端字段：**工作区侧填 HEAD OID 作占位**（HEAD 未出生时回落到另一端提交）；前端必须用 `worktree_side` 判断真实方向，不要据此字段推断。

**实现方式（纯 gix，无子进程、无写盘）**：

1. `repo.status(...)` 加 `.head_tree(目标提交树)`，同时枚举「提交树 ↔ 索引」与「索引 ↔ 工作区」两组变更，并开启 `UntrackedFiles::Files` 覆盖未跟踪文件；
2. 取路径并集（`BTreeSet` 排序去重），按 `path_filter` 过滤；
3. 逐路径读提交树条目（`lookup_path`）与磁盘文件（只读），两侧内容相同时跳过——覆盖「暂存后又改回提交内容」；
4. 行数统计用 `similar` 在内存中做行 diff；gitlink、超 2MB、非普通文件不读内容，按既有降级阶梯返回标记；
5. 上限 `MAX_FILES = 2000`（与树 diff 共用），超限返回 `diff_truncated` warning；
6. 单文件 diff 直接按两侧字节走 `diff_content`，方向由 `worktree_is_base` 决定（交换增删数与 `Added`/`Deleted`）。

**已知边界（首版接受）**：不做重命名检测（同路径视为 `Deleted` + `Added`）；只改 mode 的变更不列出；子模块不展开；工作区侧没有对象 OID，`new_oid` 恒为 `None`；bare 仓库返回 `BareRepository` + `errors.readWorktreeUnavailable`。

只读性由实现保证：只用 `repo.status()` 的只读查询（不 `write_changes`）、不创建对象、不碰 `.git/index`，`v2_readonly_static_audit` 继续通过。

### 2.5 忽略空白：各端点都显式可选

新增 `ignore_whitespace: Option<bool>`（serde 缺省 `false`），落在四个读取端点：

| 端点 | 语义 |
|---|---|
| `read_file_diff(oid, path, ignore_whitespace?)` | 提交详情单文件 diff |
| `compare_file_diff(..., ignore_whitespace?)` | 对比单文件 diff（含 `worktree` 一侧） |
| `read_stash_file_diff(oid, path, ignore_whitespace?)` | stash 单文件 diff |
| `read_staging_diff(path, staged, ignore_whitespace?)` | 暂存区单文件 diff（git-write，可跑 Git） |

`gix` 的 `blob-diff` 不提供 `git diff -w` 的等价输出，因此 `git-read` 在 `diff/unified.rs` 自建统一 diff 生成器：比较时把每行去掉**全部空白字符**作为 key（对齐 `--ignore-all-space`，同时覆盖行内与行尾空白），展示时仍输出原始行，上下文 3 行。非忽略模式继续走 `similar` 的 `unified_diff`，行为不变。

已知差异：忽略模式不输出 `\ No newline at end of file`；「仅行尾换行符差异」被视为相同；两侧只有空白差异时 patch 只剩 `--- a/…` / `+++ b/…` 两行，此时统一给出 `note_code = "diff_ignore_whitespace"`（文案「忽略空白差异后没有可见变更」），git-read 与 git-write 用同一 code。

`git-write` 侧把 `--ignore-all-space` **只**插入展示参数（`--` 之前），`tracked_diff_args` 保持不变——hunk 级写操作（ADR-0027）必须复现同一条命令才能保证 `hunk_index` 与 UI 块顺序一致，忽略空白不参与写路径。

### 2.6 图片预览：两侧都不超限才附加

- 后缀白名单：`png`、`jpg`、`jpeg`、`webp`、`gif`、`svg`（大小写不敏感），映射到 `image/*` media type；
- 仅当两侧原始字节都 ≤ `MAX_DIFF_BYTES`（2MB）、且不是 gitlink / 超限文件时附加 `image_before` / `image_after`（`data:<mime>;base64,…`）与 `image_kind`；单侧缺失（新增/删除）只给存在的一侧；
- base64 编码在 `git-core::image`，两端不重复实现；
- CSP 已允许 `img-src 'self' data:`（`tauri.conf.json` 的 `csp` 与 `devCsp` 均已包含），无需改动；SVG 只允许经 `<img src="data:image/svg+xml;base64,…">` 渲染，不得内联进 DOM（避免脚本执行面）。

**已实现**：提交详情、提交对比、工作区对比、stash 单文件 diff。**首版未实现**：`read_staging_diff`（git-write）不附带图片预览——暂存区一侧来自工作区文件、另一侧来自索引 blob，需要额外读索引对象，先保持现有降级文本行为；前端需按字段缺失降级为文本/二进制提示。

### 2.7 diff 内搜索：前端职责

diff 搜索（高亮、上下跳转、计数）完全在前端完成，后端不新增端点、不返回匹配偏移。原因：patch 文本已完整返回给前端，再传一遍偏移只增加契约面积；且搜索状态属于视图，不属于仓库快照。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 用 `git stash show -p` / `git diff` 子进程实现 stash 预览 | `git-read` 只读静态守卫禁止子进程；且违反「Git 知识各归一处」 |
| stash 预览引入专用 `StashFileDto` | 与 `ChangedFileDto` 字段重合，前端要维护两套渲染 |
| 用 `git diff --no-index` 对比工作区 | 同上；且需要临时文件写盘 |
| 在 gix `blob-diff` 上关闭空白差异 | gix 无该粒度开关；自定义统一 diff 更可控且能保留原始行 |
| 前端本地过滤空白 | 需要前端理解行级空白语义与 diff 格式，属于 Git 知识外泄 |
| 图片走自定义协议 / 新 command 取二进制 | `data:` URI 已够用且 CSP 已放行，新增通道只扩大攻击面 |
| 后端返回 diff 搜索匹配位置 | patch 已在前端，重复传输无收益 |

## 4. 后果

- `git-read` 新增 `read/worktree_compare.rs` 与 `diff/unified.rs`，`stash.rs` 扩展到 2000 文件上限；两处都在只读静态审计名单内。
- 工作区对比的 generation 仍取 refs/HEAD 指纹：工作区文件变化本身不改变 generation，前端在工作区视图需在获得文件系统事件后主动重读（与监听器既有行为一致）。
- `base` / `compare` 在 `worktree` 模式下含占位 OID，这是对既有 `Oid` 字段的语义放宽；前端必须优先读 `worktree_side`，`src/shared/types.ts` 增加该字段与 `WorktreeSide` 联合类型。
- `FileDiffDto` 新增三个可选字段，旧前端反序列化不受影响。
- `WriteKind` 数量不变（36），没有新增任何写操作；stash 预览、工作区对比、忽略空白读取、图片预览都只读。

## 5. 验收

1. `stash -u` 产生的 stash 详情同时包含 tracked 改动与未跟踪文件，`includes_untracked = true`；普通 stash 为 `false`。
2. 未跟踪文件只存在于第 3 父树时，`read_stash_file_diff` 仍能返回 `Added` 与 patch；根提交（无父）返回 `errors.readNotAStashCommit`。
3. 工作区对比同时列出已暂存、未暂存、未跟踪、删除四类文件；`worktree` 作为 Base 时状态与增删数反向。
4. 两侧同为 `worktree` 被拒绝；bare 仓库返回 `errors.readWorktreeUnavailable`。
5. 忽略空白后仅空白差异的文件增删数为 0 且带 `diff_ignore_whitespace`；含真实改动的文件仍保留改动行。
6. 图片后缀且两侧 ≤2MB 时返回 data URI；SVG 经 `<img>` 渲染不执行脚本。
7. `v2_readonly` 静态审计通过；`cargo fmt --check`、`cargo clippy -D warnings`、四个 crate 的测试全绿。
