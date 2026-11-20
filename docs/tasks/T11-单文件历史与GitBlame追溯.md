# T11：单文件提交历史（File History）与行级追溯（Git Blame）

- **波次**：Wave 3（P1 差异化核心场景深化）
- **优先级**：P1
- **前置依赖**：T01
- **是否需要 ADR**：**是**（新增只读 DTO 与 `read_file_history` / `read_file_blame` Tauri commands，须新增 `docs/adr/0031-file-history-and-blame.md` 并同步 `docs/03-技术架构.md`）
- **可并行性**：前端独立新增 `src/features/history/` 目录，与大部分前端任务无冲突

---

## 1. 背景与目标

排查线上问题或理解历史设计时，开发者最常做两件事：
1. 查看**某个特定文件的完整演进历史**（谁在什么时候改了这个文件，每次改了什么）；
2. 查看**某文件每一行代码最后是由哪个提交引入的（Blame / Annotate）**，并一键跳回那个提交查看完整上下文。

目前 GitDock 虽有路径搜索（最多扫最近 2000 条提交），但无法针对单文件给出按时间线连续翻页的历史视图与逐行 Blame 视图。

---

## 2. 范围（In Scope）与边界（Out of Scope）

### In Scope
1. **契约（`git-core` + `src/shared/types.ts`）**：
   - `FileHistoryEntryDto { commit: CommitSummaryDto, status: FileStatus, old_path?: String }`
   - `FileHistoryPageDto { generation: u64, path: String, entries: Vec<FileHistoryEntryDto>, next_cursor?: String, has_more: bool }`（沿用不透明 continuation cursor，禁止 offset！）
   - `BlameLineDto { line_no: u32, oid: Oid, short_oid: String, author_name: String, authored_at: i64, summary: String, content: String }`
   - `FileBlameDto { generation: u32/u64, oid: Oid, path: String, lines: Vec<BlameLineDto>, binary: bool, too_large: bool, encoding_fallback: bool, language?: String }`
2. **后端纯只读实现（`git-read` + `src-tauri`）**：
   - `read_file_history(path, scope_or_oid, cursor, limit)`：纯 `gix` 沿提交拓扑链检查目标路径树项变化（对比 commit 与 first-parent 对应路径 blob/tree OID 即可高效过滤未改动该文件的提交，不需全量 diff！）；分页返回并携带 `generation`。
   - `read_file_blame(oid, path)`：纯 `gix`（优先使用 `gix::Repository::blame_file` 或等效只读实现），复用 `diff_limit` 的大文件与二进制降级保护，超限返回 `too_large` / `binary` 而非 OOM。
   - 必须通过 `crates/git-read/tests/v2_readonly.rs` 静态守卫（零子进程、零写盘）。
   - 注册 Tauri command：`read_file_history`、`read_file_blame`。
3. **前端视图（新建 `src/features/history/`）**：
   - 入口：在 `CommitDetailPane`、`CompareFileList`、`StagingFileList` 的文件右键菜单中新增「查看文件历史」与「查看 Blame」。
   - `FileHistoryView.tsx`：左侧虚拟化提交时间线（支持加载更多、点击任意条目在右侧显示该提交对该文件的 diff），提供「在图谱中定位此提交」与「对比相邻版本」按钮。
   - `FileBlameView.tsx`：虚拟化行列表，左侧显示分组着色/提交者/日期/可点击短哈希（点击跳到主图谱选中该提交并打开详情），右侧显示带 Shiki 语法高亮的代码行。

### Out of Scope
- 首期不强求跨重命名的完整 `--follow` 启发式追踪（若 `gix` 成本可控可作为可选项在 ADR 说明，否则标注「仅追踪当前路径」）。
- Blame 视图只读，不支持在其中编辑代码。

---

## 3. 涉及模块与文件落点

- 文档：
  - 新增 `docs/adr/0031-file-history-and-blame.md`
  - 更新 `docs/03-技术架构.md`
- Rust：
  - `crates/git-core/src/dto/`（新增 `history.rs` 或归入 `diff.rs`）
  - `crates/git-read/src/read/file_history.rs`、`file_blame.rs` + 集成测试（线性修改、跳过无关提交、大文件/二进制降级、SHA-256 兼容）
  - `src-tauri/src/app/commands/read.rs` & `src-tauri/src/lib.rs`
- 前端：
  - `src/shared/types.ts`、`src/shared/ipc.ts`
  - 新建 `src/features/history/FileHistoryView.tsx`、`FileBlameView.tsx`、`useFileHistory.ts`
  - `src/features/detail/CommitDetailPane.tsx`、`compare/CompareView.tsx`、`staging/StagingView.tsx`（接入文件右键菜单）
  - `src/styles/history.css`、`src/i18n/locales/{zh-CN,en}/history.ts`（同步注册新命名空间到 `src/i18n/index.ts` 与 `types.ts`）

---

## 4. 验收标准

- **Given** 一个被 5 个提交修改过、期间夹杂 50 个无关提交的文件，**When** 右键「查看文件历史」，**Then** 准确列出这 5 个提交，选中任一条目右侧展示该次改动 diff，点击定位可回到主图谱选中该提交。
- **Given** 右键一个由 3 个不同提交写入不同行的代码文件并点「查看 Blame」，**When** 加载完成，**Then** 每行准确归属到对应提交作者与短哈希，且代码保留语法高亮；点击短哈希可在主图谱定位该提交。
- **Given** 对二进制文件或超大文件执行 Blame，**When** 请求返回，**Then** 优雅降级展示提示文案，应用不卡死、不崩溃。
- **Given** 执行 `npm run check`，**When** 校验结束，**Then** `v2_readonly` 静态守卫、IPC 契约、i18n 及全量测试全部通过，所有触及文件 ≤ 600 行。
