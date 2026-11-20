# T04：详情/Diff 浏览体验、搜索与高频快捷键增强

- **波次**：Wave 1（体验优化）
- **优先级**：P1
- **前置依赖**：建议在 T01 后执行
- **是否需要 ADR**：否（前端交互与只读搜索过滤增强；若扩展 `SearchRequest` DTO 则需同步更新 `git-core`、`src/shared/types.ts`、`docs/03-技术架构.md` 并补 ADR）
- **可并行性**：可与 T02、T03、T05 并行

---

## 1. 背景与目标

日常高频浏览提交、看 diff 与检索历史时存在四处高频体验短板：
1. [CommitDetailPane.tsx](file:///C:/zy/project_other/ai-projects/git-graph/src/features/detail/CommitDetailPane.tsx#L175-L179) 中父提交 OID 是纯文本 `<code>`，不能点击跳转到父提交。
2. [FileDiffView.tsx](file:///C:/zy/project_other/ai-projects/git-graph/src/features/diff/FileDiffView.tsx#L63) 中 `viewType`（分栏 `split` / 统一 `unified`）未持久化到 `localStorage`，每次切换提交或重开视图都会重置。
3. [keybindings.ts](file:///C:/zy/project_other/ai-projects/git-graph/src/shared/keybindings.ts#L11) 目前只支持 4 个快捷键（终端开合 + 缩放三档），缺少搜索、刷新、切换暂存区、图谱上下键移动选中、Diff 上下文件切换等高频快捷键。
4. [SearchView.tsx](file:///C:/zy/project_other/ai-projects/git-graph/src/features/search/SearchView.tsx) 关闭即清空所有搜索结果，想逐条排查多个命中提交时必须反复重搜；且缺少按命中域（消息/作者/路径/Hash）筛选。

---

## 2. 范围（In Scope）与边界（Out of Scope）

### In Scope
1. **父提交 OID 可点击跳转**：
   - 在 `CommitDetailPane` 中将父提交 `<code>` 改为可点击按钮；点击后调用上层定位回调（复用 `graph.jumpTo(parentOid)` + 选中并滚动到该提交），若父提交不在当前 scope 内可自动提示或切换到 `all` 后定位。
2. **Diff 视图模式持久化**：
   - 在 `FileDiffView.tsx` 中将 `viewType`（`"split" | "unified"`）持久化至 `localStorage`（键名遵循既有风格 `git-graph.diff-view-type`），所有用到 `FileDiffView` 的场景（提交详情、对比、暂存区）自动同步偏好。
3. **补齐高频快捷键与图谱键盘导航**：
   - 在 `keybindings.ts` 及设置「快捷键」分区补充可配置或固定快捷键（遵守现有安全校验规则，不抢占输入框内 `Ctrl+C`/`V`/`A`）：
     - 打开搜索（如 `Ctrl+Shift+F` 或 `Ctrl+/`，注意避开浏览器/输入冲突，或在非输入框聚焦时支持 `/` 快捷呼出搜索）；
     - 手动刷新（如 `F5`）；
     - 切换暂存区视图（如 `Alt+2` / `Alt+1` 切回图谱）；
   - 图谱列表（`GraphList`）获得焦点时支持 `ArrowUp` / `ArrowDown` 切换选中提交并自动滚动到可视区（`virtualizer.scrollToIndex`）；
   - Diff 视图支持快捷键（如 `Alt+↑` / `Alt+↓` 或工具栏标明）在变更文件间快速切换。
4. **搜索结果保留与命中域筛选**：
   - 从 `SearchView` 点击某条结果定位到图谱后，不再立即调用 `search.reset()` 丢弃上次查询与结果（改为保留本次会话内的搜索结果，直到用户主动点「清空」按钮或切换仓库/scope 变更时重置）；
   - 在搜索结果区增加轻量前端过滤标签（全部 / 提交说明 / 作者 / 路径 / Hash），便于在大量命中中快速收窄；
   - 保持 `SearchView` 虚拟化与取消搜索机制不变。

### Out of Scope
- 不在本任务改动后端搜索索引算法或引入全文正则引擎（保持对 `crates/git-read/src/search.rs` 零侵入或最小侵入）。
- 不改动既有 `Esc` 分层消费协议。

---

## 3. 涉及模块与文件落点

- 前端修改：
  - `src/features/detail/CommitDetailPane.tsx`（新增 `onSelectCommit?: (oid: string) => void`，父提交按钮化）
  - `src/features/diff/FileDiffView.tsx`（`viewType` 持久化 + 可选文件切换快捷键）
  - `src/features/graph/GraphList.tsx`（`tabIndex={0}` + `ArrowUp`/`ArrowDown` 键盘导航）
  - `src/features/search/SearchView.tsx`（保留结果、新增「清空」按钮与命中域筛选 chip）
  - `src/shared/keybindings.ts` & `src/features/settings/KeyBindingsSection.tsx`（同步新增动作与固定键位文档）
  - `src/App.tsx`（接入父提交跳转、搜索关闭不重置但保留显式清空、新快捷键绑定）
  - `src/styles/{detail,search,graph}.css`
  - `src/i18n/locales/{zh-CN,en}/{detail,search,settings,graph}.ts`

---

## 4. 关键设计约束

- **不干扰终端与输入框**：键盘导航（`ArrowUp`/`ArrowDown`）仅在 `GraphList` 自身拥有焦点时生效，且在底部终端面板（`.bottom-panel`）或弹窗（`.modal-backdrop`）激活时绝不拦截按键。
- **跨平台快捷键显示**：严格复用 `shared/keybindings.ts` 与 `ADR-0006` 的 macOS `⌘` 显示映射机制。
- **行数控制**：`keybindings.ts` 现 417 行，若新增逻辑使其接近 500 行，应把键位常量/校验拆分到同目录辅助模块。

---

## 5. 验收标准

- **Given** 打开任意非根提交（含 merge commit）的详情面板，**When** 点击任一父提交短哈希，**Then** 图谱滚动定位并选中该父提交，详情面板同步切换显示该父提交。
- **Given** 在 Diff 视图切换到「统一视图（Unified）」，**When** 切换其他提交或重新打开应用，**Then** 仍保持统一视图而非重置为分栏。
- **Given** 搜索关键词并点击第 1 条结果定位到图谱，**When** 再次打开搜索框，**Then** 上次关键词与结果列表仍在，且可按命中域筛选或点击「清空」重新开始；切换仓库后自动清空。
- **Given** 焦点在图谱列表，**When** 按 `↑`/`↓` 键，**Then** 选中行平滑上下移动并刷新详情；焦点在底部终端内时方向键仍归终端所有。
- **Given** 执行 `npm run check`，**When** 校验完成，**Then** 全部门禁通过，所有触及文件 ≤ 600 行。
