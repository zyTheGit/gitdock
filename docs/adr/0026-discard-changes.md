# ADR 0026：丢弃未暂存改动与清理未跟踪文件

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 影响范围：`crates/git-core/src/dto/write.rs`（WriteKind）、`crates/git-write`（`gate.rs`、`execute.rs`、新增 `discard/{mod,gate,execute,tests}.rs`、集成测试 `tests/write_discard.rs`）、`src/shared/types.ts`、`docs/03-技术架构.md`、前端暂存区（`StagingView` / `StagingFileList` / 确认框 / i18n，另行实现）
- 触发依据：任务 T06「工作区改动丢弃与未跟踪清理」

## 1. 背景

暂存区已支持 stage / unstage / commit / 手动 stash，但缺少「丢弃未暂存改动」（`git restore --worktree`）与「删除指定未跟踪文件」。丢弃是**不经 Git reflog 的永久数据销毁**：索引被覆盖后旧工作区内容没有任何 Git 侧留痕，因此必须进白名单、过 Gate、显式二次确认，并且只能作用于用户明确点选的文件。

## 2. 决策

### 2.1 契约：单一 `discard_files`

`WriteKind` 只新增一个变体 `discard_files`，不拆成 `discard_files` + `remove_untracked`。

- **理由**：用户心智是一件事——「丢弃我勾选的这些改动」。前端在未暂存列表里勾选的文件可能同时包含已跟踪与未跟踪条目；单一 kind 让前端发一次请求、Gate 一次判定、执行一次收尾，避免两次请求之间出现「一半已删、一半失败」并需要两个确认框。
- **后端分类**：tracked / untracked 由服务端按 `status_detail()` 判定，前端不声明路径性质（前端不能借声明绕过 Gate）。请求复用既有 `paths` 字段，不新增字段，旧请求仍可反序列化。
- **代价**：结果文案需要同时报告两类计数（`tracked` / `untracked` / `total`）。

### 2.2 tracked 与 untracked 的判定

`discard::plan(entries, paths)` 是唯一的分类入口（纯函数，Gate 与执行共用）：

| 判定 | 条件 | 动作 |
|---|---|---|
| tracked 未暂存 | 状态条目 `untracked == false` 且 `worktree_code != '.'` | 工作区从 index 恢复 |
| untracked | 状态条目 `untracked == true` | 删除该路径 |
| 仅已暂存（`index_code != '.'` 且 `worktree_code == '.'`） | — | Gate 拒绝：`gate_nothing_to_discard` |
| 冲突（`u ` 条目） | — | Gate 拒绝 |

请求中的路径必须在**当前** `git status` 里出现，且属于上表前两行之一；状态里没有的路径一律拒绝（`gate_path_not_in_status`），防止拼写错误或过期 UI 把删除作用到别的文件。

### 2.3 路径校验

按序校验，任何一条失败即拒绝整个请求（不做「部分执行」）：

1. `safe_rel_path`（复用 staging 的实现）：非空、无首尾空白、不以 `/` `\` `:` `-` 开头、不含反斜杠、每个 `/` 分段非空且不是 `.` / `..`。选项注入（`-x`、`--force`）在此与下面的 NUL pathspec 双重免疫。
2. Windows 形态的绝对路径与 NUL 显式拒绝：盘符（`C:` / `C:/`）、UNC（`\\server`）、任意位置的 `\0`。
3. 路径不能是 `.git` 或其子路径（大小写不敏感比较首段）。
4. 路径必须存在于当前 status 的未暂存/未跟踪列表（见 2.2）。
5. 数量上限沿用 `MAX_STAGING_PATHS`（1000），去重后计数。

未跟踪**目录**（status 中形如 `dir/`）被拒绝（`gate_untracked_directory`）：递归删除无法在「不碰 ignored 文件」的前提下保证安全（目录内可能有被忽略的内容），本期只开放到文件与符号链接粒度。

### 2.4 确认期望（前端契约）

- 确认框必须标红为破坏性操作，展示 Gate 返回的 `affected_paths`（最多 50 条）与 `affected_total`，并明示：**未暂存改动 / 未跟踪文件将被永久删除，无法通过 `git reflog` 恢复；需要保留请先 Stash**。
- Gate 额外返回 `discard_destructive` warning（含 tracked / untracked / total 计数），前端据此组织文案。
- 不提供「丢弃整个仓库」入口：`paths` 为空直接拒绝（`gate_paths_required`），前端无法只靠确认框绕过预览。
- 不提供丢弃已暂存改动（Out of Scope）：只暂存的文件会被 `gate_nothing_to_discard` 拒绝。

### 2.5 命令机制

**tracked**：`git restore --worktree --pathspec-from-file=- --pathspec-file-nul`，stdin 为 NUL 分隔的相对路径（去重）。只改工作区、不动索引，因此同一文件的已暂存内容完整保留；`--pathspec-from-file` 由 2.26 起可用，低于 `MINIMUM_GIT_VERSION`（2.30.0）要求，安全。

**untracked**：**不使用 `git clean`**。`git clean --pathspec-from-file` / `--pathspec-file-nul` 是 Git 2.45 才加入的（`git-clean` 手册在 2.24.0→2.39.0 之间无该选项，2.45.0 手册才出现），在 2.30.0 上会直接报未知选项。改为**逐路径受校验的文件系统删除**：

1. 重新读取 status，路径必须仍是未跟踪条目（防 TOCTOU 后的非法目标）；
2. `root.join(path)` 后 `canonicalize`，必须成功（存在且可解析）；
3. 规范化结果必须 `strip_prefix(规范化 root)` 成功——符号链接指到仓库外即失败；
4. 再用 `symlink_metadata` 判断类型：普通文件 / 符号链接 → `remove_file`（符号链接只删链接本身，不跟随）；目录 → 拒绝（见 2.3）；
5. 空父目录不清理，留给用户或后续版本。

绝不执行无路径参数的 `git clean -fd`，绝不 `-x`，绝不触碰 `.git`。

**执行顺序**：先 `restore`（若有 tracked 路径），成功后再逐个删除 untracked；任一步失败即返回 `Failed` 并附 stderr / 路径，已完成的删除不回滚（在文案中说明）。纯 untracked 请求不产生任何 git 命令。

### 2.6 接入方式

- Gate 在既有 `GitWriteModule::validate` 中多一个分支，细节在 `discard/gate.rs::validate_discard`（返回 issues / warnings / affected_paths / affected_total / summary）。
- 执行在既有 `GitWriteModule::execute` 中委托给 `discard/execute.rs::execute_discard`，沿用同一把 `write_lock` 与「Gate 不通过即 Rejected」语义。
- **不新增 Tauri command**：`validate_write` / `execute_write` 已经承载受限 DTO + Gate，`WriteRequest.paths` 足够表达本操作，新增命令只会多一个待审计的跨进程入口。命令日志由 `run_git_*` seam 统一记录。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 两个 kind（`discard_files` + `remove_untracked`） | 混合勾选需要两次请求与两次确认，中途失败语义割裂；用户心智是单一动作 |
| 前端声明每个路径是 tracked / untracked | 让前端参与安全判定，跨进程契约被扩大，且 status 可能已变化 |
| `git clean -f --pathspec-from-file=- --pathspec-file-nul` | Git 2.45 才有该选项，低于 `MINIMUM_GIT_VERSION` 2.30.0 的机器直接失败 |
| `git clean -f -d -- <paths>`（字面路径参数） | 目录删除会连带目录内的 ignored 文件，与「绝不清理 ignored」冲突；且 `clean` 的 `requireForce` 等配置会让行为随环境漂移 |
| `git checkout -- <paths>` 替代 restore | 已废弃用法，语义含混（同时可能动索引），restore 更明确 |
| 允许删除未跟踪目录（`remove_dir_all`） | 目录内可能含 ignored 或用户数据，无法在不读 ignore 规则的前提下保证安全 |
| 新增专用 Tauri command | 通用 validate/execute seam 已够用，多开入口违反「不给前端开通用路径通道」 |

## 4. 后果

- `WriteKind` 增至 28 项，`types.ts` 同步；`discard_files` 与其他写操作共享同一把仓库写锁与命令日志。
- Gate 报告新增 `discard_destructive` warning；受影响文件清单上限仍为 50，超出部分靠 `affected_total` 说明。
- 丢弃不受 reflog 保护，前端必须使用强破坏性确认框（2.4）。
- 未跟踪目录、ignored 文件、已暂存改动都不在本操作能力内，属已知边界。
- 部分失败可能发生（例如 restore 成功而某个未跟踪文件被外部进程占用）；结果文案必须说明「已完成的部分不回滚」。

## 5. 验收

1. 同一文件既有已暂存修改又有新的未暂存修改：丢弃后工作区回到 index 内容，暂存内容不变。
2. 未跟踪文件（含中文与空格）被删除，其余未跟踪文件与 `.gitignore` 忽略的文件保持原样。
3. merge / cherry-pick / rebase 中断态、冲突索引：Gate 拒绝，工作区零改动。
4. 不在当前 status 内的路径、`../` 穿越、绝对路径、`-` 开头路径：Gate 拒绝。
5. 未跟踪目录：Gate 拒绝并提示使用终端。
6. `cargo test -p git-write`、`cargo clippy -p git-core -p git-write --all-targets -- -D warnings`、`cargo check -p gitdock-app --all-targets`、`cargo fmt --all -- --check` 全绿；触及文件 ≤ 600 行。
