# T17：Worktree 自适应展示

- **波次**：Wave 1（首屏精简）
- **优先级**：P1
- **前置依赖**：无
- **是否需要 ADR**：否（纯前端条件展示）
- **可并行性**：可与 T14、T15、T16 并行
- **粗略成本**：0.5–1 人日

---

## 1. 背景与目标

普通仓库即使只有主 Worktree，也会显示完整 Worktree 分区，增加侧栏噪声。

目标：只有一个 Worktree 时使用紧凑展示；多个时保留完整列表；bare 仓库继续整段隐藏。

---

## 2. 范围与边界

### In Scope

1. 保留加载、空、错误和刷新状态。
2. `worktrees.length === 1` 时显示紧凑行：
   - Worktree 名称或路径。
   - 当前 / linked 状态（若 DTO 已提供）。
   - 打开入口。
   - 创建入口。
   - 移除入口（保留原有禁用与确认约束）。
3. `worktrees.length > 1` 时显示现有完整分区和列表。
4. 保留用户手动折叠状态；自适应只影响默认展示密度。
5. bare 仓库不发起读取且不显示分区。

### Out of Scope

- 不修改 Worktree DTO 或后端读取。
- 不改变创建、移除、打开和 Gate 语义。
- 不新增自动刷新或轮询。
- 不自动打开、移除或切换 Worktree。

---

## 3. 涉及模块与文件落点

- `src/features/worktree/WorktreeSection.tsx`
- `src/features/worktree/WorktreeRow.tsx`（仅复用或微调）
- `src/styles/worktree.css`
- `src/i18n/locales/zh-CN/worktree.ts`
- `src/i18n/locales/en/worktree.ts`

---

## 4. 关键设计约束

- 加载完成前不得先显示“单 Worktree 紧凑态”再闪烁为完整列表。
- 紧凑行仍须保留当前 Worktree 的上下文，不能变成孤立图标。
- 创建和移除入口的 busy / disabled 行为不变。
- 不增加动画。

---

## 5. 实施步骤

1. 确认 `useWorktrees` 的 loading / null / 空数组状态。
2. 为 `WorktreeSection` 增加单条紧凑展示分支。
3. 复用 `WorktreeRow` 的打开与移除能力，避免第二套逻辑。
4. 调整样式和双语文案。
5. 验证 0 / 1 / 多条、bare、加载和错误状态。

---

## 6. 验收标准

- **Given** 普通仓库只有一个 Worktree，**When** 侧栏加载完成，**Then** 显示紧凑行而非完整分区，打开、创建和移除入口仍可用。
- **Given** 仓库有多个 Worktree，**When** 侧栏加载完成，**Then** 显示完整列表、计数和既有折叠行为。
- **Given** bare 仓库，**When** 打开侧栏，**Then** 不显示 Worktree 分区且不发起 Worktree 读取。
- **Given** 正在加载或读取失败，**When** 查看分区，**Then** 显示对应加载或错误状态，不误显示单条紧凑态。
- **Given** 执行 `npm run check`，**When** 校验结束，**Then** 全部门禁通过，触及文件满足行数限制。

---

## 7. 交付状态（2026-11-26）

- **状态**：代码完成，release CDP 指定路径通过；用户实机验收仍独立保留。
- **实现**：单 Worktree 紧凑行、多条完整列表、bare 整段隐藏且不读取；加载/空/错误/折叠状态保留。
- **集成修复**：仓库切换时通知携带仓库身份并过滤旧结果，旧仓库异步回调不能污染新仓库。
- **证据**：release exe + CDP 验证紧凑态、折叠、创建对话框、紧凑态移除禁用、两条完整列表、bare 隐藏/禁用；通过隔离 PATH 移除 git 可执行文件注入 spawn 失败，验证错误态与重试恢复。`npm run check` 七项全绿（373 passed / 1 ignored）。
