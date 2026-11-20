# T10：Stash 内容预览、工作区对比与 Diff 进阶体验

- **波次**：Wave 3（P1 差异化核心场景深化）
- **优先级**：P1
- **前置依赖**：T01
- **是否需要 ADR**：**是**（新增只读 Tauri command 与 Diff 选项契约，须先新增 `docs/adr/0030-stash-preview-and-diff-options.md` 并同步 `docs/03-技术架构.md`）
- **可并行性**：纯只读能力扩展，可与 T11 协调后并行（注意共享 `dto` 文件避免冲突）

---

## 1. 背景与目标

GitDock 的核心竞争力是**对比与 Diff 浏览体验**。当前有三项高价值缺口：
1. [StashDialog.tsx](file:///C:/zy/project_other/ai-projects/git-graph/src/features/staging/StashDialog.tsx) 只能看到 stash 的 message 和时间，不能预览每条 stash 里具体改了哪些文件和 diff，容易误 apply 或误 drop。
2. 双槽对比（`CompareView`）目前只能对比两个已提交的 OID，不能直接把**当前工作区 / 暂存区**与任意目标分支（如 `main`、`origin/release`）做整体对比；且对比结果不能按文件状态（A/M/D/R）筛选。
3. [FileDiffView.tsx](file:///C:/zy/project_other/ai-projects/git-graph/src/features/diff/FileDiffView.tsx) 缺少「忽略空白字符（`-w`）」、Diff 内文本搜索、图片类二进制文件可视化预览等高频 Code Review 辅助功能。

---

## 2. 范围（In Scope）与边界（Out of Scope）

### In Scope
1. **Stash 内容预览**：
   - `git-read` 复用或新增 `read_stash_detail(oid)` / `read_stash_file_diff(oid, path)`（注意 stash commit 结构：第 1 父是原 HEAD、第 2 父是 index、第 3 父可选为 untracked 树，需正确合并展示 tracked 改动及 `-u` 时的 untracked 文件）；
   - `StashDialog` 升级为宽模态双栏布局：左侧为保存表单 + stash 列表，右侧选中某条 stash 时展示文件清单与 `FileDiffView` 预览。
2. **对比视图按状态筛选 & 工作区对比**：
   - `CompareView` 路径过滤栏旁增加文件状态筛选切换（全部 / 新增 A / 修改 M / 删除 D / 重命名 R）。
   - 支持特殊对比槽位「当前工作区（Working Tree）」（在 `Compare` 槽选择工作区与任意分支/提交对比）：后端只读通道计算工作区相对指定 commit tree 的文件列表与单文件 diff（纯 `gix` 或复用 `git-write` 只读 status/diff，需在 ADR-0030 明确落在哪个模块以严格遵守架构边界）。
3. **Diff 进阶能力**：
   - **忽略空白变化（Ignore Whitespace）**：后端 `read_file_diff` / `compare_file_diff` / `read_staging_diff` 支持可选参数 `ignore_whitespace?: bool`（默认 `false`，兼容旧调用）；`FileDiffView` 头部新增「忽略空白」切换图标并持久化。
   - **Diff 内搜索**：在 `FileDiffView` 激活时提供轻量搜索条（定位并高亮匹配行、上一个/下一个跳转）。
   - **图片预览（可选增强）**：对于常见图片后缀（png/jpg/webp/gif/svg）且体积在安全阈值内（如 ≤ 2 MiB）的 binary diff，返回只读 base64 预览数据并排对比旧图/新图（SVG 必须以 `<img>` data URI 渲染，严禁内联 DOM 防止 XSS，且需核对 `tauri.conf.json` CSP 的 `img-src` 策略）。

### Out of Scope
- 不修改现有 stash 写操作语义。
- 不支持在 Diff 视图直接编辑代码。

---

## 3. 涉及模块与文件落点

- 文档：
  - 新增 `docs/adr/0030-stash-preview-and-diff-options.md`
  - 更新 `docs/03-技术架构.md`
- Rust：
  - `crates/git-core/src/dto/diff.rs`（可选图片预览字段 / diff 选项）
  - `crates/git-read/src/read/stash.rs`、`crates/git-read/src/diff/`（stash 3-parent 处理、ignore whitespace 支持）
  - `src-tauri/src/app/commands/read.rs`、`src-tauri/src/lib.rs`
- 前端：
  - `src/shared/types.ts`、`src/shared/ipc.ts`
  - `src/features/staging/StashDialog.tsx` + 新建 `StashPreviewPane.tsx`
  - `src/features/compare/CompareView.tsx`、`BranchCompareDialog.tsx`
  - `src/features/diff/FileDiffView.tsx` + 新建 `DiffSearchBar.tsx` / `ImageDiffView.tsx`
  - `src/styles/{staging,compare,diff}.css`
  - `src/i18n/locales/{zh-CN,en}/{staging,compare,diff}.ts`

---

## 4. 验收标准

- **Given** 仓库存在普通 stash 与包含未跟踪文件（`-u`）的 stash，**When** 打开 Stash 弹窗并选中条目，**Then** 右侧准确列出所有改动与未跟踪文件并可查看对应 diff。
- **Given** 在对比视图勾选状态过滤（如仅看新增/删除），**When** 切换过滤条件，**Then** 文件列表与计数即时更新。
- **Given** 打开仅调整缩进/空格的 diff 文件，**When** 开启「忽略空白」，**Then** 纯空白变更行被过滤，逻辑变更清晰可见。
- **Given** 在 Diff 视图内搜索关键字，**When** 输入关键词并点击上/下一个，**Then** 命中行高亮并滚动到视野中。
- **Given** 执行 `npm run check`，**When** 校验结束，**Then** 全部门禁与测试通过，所有触及文件 ≤ 600 行。
