# T07：Hunk 与行级暂存 / 取消暂存 / 丢弃

- **波次**：Wave 2（P0 核心 Git 能力闭环）
- **优先级**：P0
- **前置依赖**：T01（建议在 T06 合并后执行，共享暂存区安全边界）
- **是否需要 ADR**：**是**（本能力将正式修订 `docs/03-技术架构.md` 与 `ADR-0002` 中“不做部分行暂存”的既有边界，须先新增 `docs/adr/0027-hunk-staging.md`）
- **可并行性**：与 T06/T08/T09 串行合并

---

## 1. 背景与目标

开发过程中经常出现同一个文件既有本次功能代码、又有临时调试日志或另一项任务改动。当前暂存区只支持整文件 `stage` / `unstage`，缺少按 Hunk（甚至按选中行）精细控制暂存的能力，导致用户必须切到终端执行 `git add -p` 或启动 LazyGit。

目标：在保持 `GitWriteModule` 白名单、Gate 与安全不变量的前提下，支持在暂存区 diff 中按 **Hunk 级（首期必做）** 及 **行级（选做/二期，须在 ADR 中明确范围）** 执行暂存、取消暂存与丢弃。

---

## 2. 范围（In Scope）与边界（Out of Scope）

### In Scope
1. **ADR-0027 边界定稿**：
   - 明确 patch 构造位置（前端或后端按结构化 hunk index 从实时 diff 提取，**强烈推荐由后端按 `(path, hunk_index, staged)` 重新生成合法 unified patch**，不直接信任前端拼装的任意原始 patch 文本，防止伪造路径或跨文件注入！）；
   - 同步修订 `docs/03-技术架构.md` 中 `GitWriteModule` 不变量描述。
2. **契约与后端实现（`git-core` + `git-write`）**：
   - `WriteKind` 新增 `StageHunk`、`UnstageHunk`、`DiscardHunk`（或用结构化字段 `hunk_index: Option<u32>` + `selected_lines?: Option<Vec<u32>>`）；
   - Gate 校验：拒绝 bare / 中断态 / 冲突文件 / 二进制文件 / 未跟踪文件（untracked 文件无 index 基准，不走 hunk apply，提示整文件暂存）/ 越界 `hunk_index`；
   - 命令执行（通过 `run_git_with_stdin` 喂入后端校验后生成的单文件单 hunk patch）：
     - `StageHunk`：`git apply --cached --unidiff-zero -`（或标准上下文 patch）
     - `UnstageHunk`：`git apply --cached --reverse -`
     - `DiscardHunk`：`git apply --reverse -`（破坏性操作，必须二次确认！）
3. **前端交互（`FileDiffView` + `StagingView`）**：
   - 为 `FileDiffView` 增加可选的 `hunkActions` 回调（仅 `StagingView` 传入，提交详情与对比视图保持纯只读，不出现写按钮）；
   - 在每个 hunk 头部右侧渲染紧凑操作按钮：
     - 未暂存侧：`暂存此块` / `丢弃此块…`（丢弃弹破坏性确认框）
     - 已暂存侧：`取消暂存此块`
   - 每次操作完成后静默刷新暂存区列表、当前文件 diff（若当前文件已无剩余 hunk 则切到下一个文件）及工作区状态快照。

### Out of Scope
- 禁止接收前端传来的任意原始 `git apply` patch 文本并盲目执行（必须校验目标仅限单个合法 `path` 且来自当前实时 diff）。
- 二进制文件、重命名/权限变更、submodule gitlink、unborn HEAD 的未跟踪文件不做 hunk 级操作。

---

## 3. 涉及模块与文件落点

- 文档：
  - 新增 `docs/adr/0027-hunk-staging.md`
  - 更新 `docs/03-技术架构.md`
- Rust：
  - `crates/git-core/src/dto/write.rs`（新增 `WriteKind` 及 hunk 请求字段）
  - 新建 `crates/git-write/src/hunk/`（`mod.rs` / `patch.rs` / `gate.rs` / `tests.rs`）
  - `crates/git-write/src/command.rs`、`gate.rs`、`execute.rs`
  - 集成测试：覆盖多 hunk 文件中只暂存第 2 个 hunk、从 staged 取消暂存单个 hunk、丢弃单个 hunk（不伤及同文件其他 hunk 与已暂存内容）、无尾换行（`\ No newline at end of file`）边界、非法 hunk_index 拒绝
- 前端：
  - `src/shared/types.ts`
  - `src/features/diff/FileDiffView.tsx` & `SplitDiffPanes.tsx`（支持 hunk header 操作插槽，注意同时兼容分栏 `paneMode` 与统一视图！）
  - `src/features/staging/StagingView.tsx`
  - `src/styles/diff.css`、`src/i18n/locales/{zh-CN,en}/{diff,staging,errors}.ts`

---

## 4. 关键设计约束

- **分栏与统一视图双支持**：`FileDiffView` 在 `split && !wrap` 时走自绘 `SplitDiffPanes.tsx`，其余走 `react-diff-view` 的 `<Diff><Hunk>`；两种渲染路径都必须正确展示 hunk 操作按钮。
- **并发防漂移**：若用户在看 diff 期间外部修改了文件导致 hunk 数量变化，后端应校验失败并返回清晰错误提示刷新，而不是把补丁打歪。

---

## 5. 验收标准

- **Given** 一个已跟踪文件有 3 个独立 hunk 修改，**When** 在暂存区点击第 2 个 hunk 的「暂存此块」，**Then** 仅第 2 个 hunk 进入 `staged`，第 1、3 个 hunk 留在 `unstaged`，两侧 diff 立即刷新正确。
- **Given** 对已暂存的某文件点击单个 hunk 的「取消暂存此块」，**When** 操作完成，**Then** 仅该 hunk 退回工作区。
- **Given** 对未暂存 hunk 点击「丢弃此块…」，**When** 弹出破坏性确认框并确认，**Then** 仅该 hunk 改动被还原，同文件其他 hunk 保留。
- **Given** 文件末尾缺少换行符（`\ No newline at end of file`），**When** 对末尾 hunk 执行暂存或取消暂存，**Then** `git apply` 成功且内容精确无损坏。
- **Given** 执行 `npm run check`，**When** 校验结束，**Then** 全部门禁通过，所有触及文件 ≤ 600 行。
