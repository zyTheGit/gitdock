# 15 — 分支对比增强与节点悬浮卡精简 PRD

- 文档版本：v1.0
- 状态：待评审确认
- 关联模块：`crates/git-core`、`crates/git-read`、`src/features/compare/`、`src/features/graph/`、`src/i18n/`、`src/styles/`

---

## 1. 背景与问题

### 1.1 分支对比“一眼看不出区别”
当前分支对比页（`CompareView`）沿用了“单次提交详情 / PR 单向评审”的布局，在对比两个分支时存在 4 个核心体验短板：
1. **单向视角缺失一半信息**：提交列表只展示 Compare 侧引入的提交，Base 侧独有提交不可见；头部仅用一行弱化灰字提示 `左侧 Base 独有 X · 右侧 Compare 独有 Y`。
2. **缺少第一眼总览**：进入页面直接选中第一个文件展示代码 Diff，提交列表被压在左下角 `160px` 高度内，无法一眼判断两者的拓扑关系（领先、落后、分叉、快进）与变更量级。
3. **术语方向感弱**：反复出现 `Base / Compare / 三点 diff / 两点快照`，用户需要自行映射为具体分支名和真实意图。
4. **冲突风险与归属不可见**：分叉对比时看不出哪些文件被双方同时修改（合并高风险区）；两点快照模式下双侧改动混在一起，分不清改动归属。

### 1.2 图谱提交悬浮卡过重且干扰浏览
当前 `CommitHoverCard` 悬停在整行任意位置停留 `260ms` 即弹出 `380px` 宽的大卡片，内含作者、邮箱、时间、父提交、所有本地分支的 `gap` 提交明细，既挡视线，也与详情面板、分支对比页职责重叠。

---

## 2. 产品目标与设计原则

- **职责分离**：
  - **节点悬浮卡**：轻快回答“这个提交在不在 HEAD、属于哪些分支”。
  - **分支对比页**：一眼回答“两个分支是什么关系、各自做了什么、哪些文件撞车了”。
- **覆盖三类高频场景**：
  - **A. 合并 / 发版前检查**：相对基准分支多了什么、漏合了什么、哪些文件可能冲突。
  - **B. 长期分支差异排查**：两个分叉分支各自改了什么、文件差异归属哪一侧。
  - **C. 任意提交 / 工作区快照对比**：简洁呈现两端完整差异，不引入无关分叉噪音。
- **精简且有特色**：不堆砌多 Tab 重型页面，保持桌面端高密度单屏体验，聚焦**「差异速览卡 + 双向提交 + 文件归属/撞车标」**三个核心亮点。

---

## 3. 功能需求（一期：核心闭环）

### 3.1 分支对比页升级

#### 3.1.1 顶部「差异速览卡」
替代当前 `CompareHeader` 的松散标题与灰字统计，用真实引用名直接给出结论：

| 拓扑状态 | 判定条件 | 速览卡主结论示例 |
| :--- | :--- | :--- |
| 可快进（领先） | `base_only == 0 && compare_only > 0` | `可快进` · `feat/a` 领先 `develop` **5** 提交 |
| 已落后 | `base_only > 0 && compare_only == 0` | `已落后` · `feat/a` 落后 `develop` **3** 提交 |
| 已分叉 | `base_only > 0 && compare_only > 0` | `已分叉` · `develop` 独有 **2** · `feat/a` 独有 **5** |
| 完全一致 | `base.oid == compare.oid` | `完全一致` · 两者指向同一提交 |
| 无共同祖先 | `mode == two_dot_fallback` | `无共同祖先` · 已切换为两端完整快照 |
| 工作区 / 快照 | `worktree` 或 `two_dot` | `完整快照` · `A → B`（不展示分叉噪音） |

- **微型双向比例条（Ahead / Behind Bar）**：在“领先 / 落后 / 分叉”状态下，用左右两色细条直观呈现 `base_only : compare_only` 比例。
- **分叉点入口**：存在 `merge_base` 时展示 `分叉于 <short_oid>`（悬停显示分叉点提交标题），点击可直接返回图谱并定位该提交。
- **紧凑变更统计**：展示总文件数、按状态拆分的计数（如 `A 3 · M 8 · D 1 · R 1`，为 0 的状态可省略）以及 `+additions / -deletions`。
- **意图化模式切换**：
  - 三点模式文案改为 `仅看分支改动 (...)`（tooltip 保留 `git diff base...compare` 说明）。
  - 两点模式文案改为 `两端完整快照 (..)`（tooltip 保留 `git diff base compare` 说明）。
  - 保留原有「目录对比」「查看图谱」入口；当三点模式下 `compare_only == 0 && base_only > 0`（即 Compare 落后于 Base）时，提示条明确说明原因并突出“查看 Base 独有提交”或“切换为两端完整快照”动作。

#### 3.1.2 左侧「双向提交列表」
改造现有 `CompareCommitList`，使其可查看双向独有提交：
- **双向切换胶囊**：
  - `[ <Compare 名称> 独有 (N) ]` 与 `[ <Base 名称> 独有 (M) ]`（名称过长时截断并保留 `title` 提示）。
  - **自动默认选中**：默认选 Compare 侧；若 Compare 独有为 `0` 且 Base 独有 `> 0`，自动切到 Base 侧，避免一进来看到空列表。
  - **工作区对比**：工作区无提交历史，保持当前提示或折叠提交区，不显示无意义切换。
- **交互**：
  - 保持虚拟列表与底部拖拽调高能力。
  - 点击提交仍支持打开提交详情，右键菜单沿用现有 `commitMenu`。
  - 两侧各自保持截断上限（`200` 条）与 `+` 截断标识。

#### 3.1.3 文件列表「改动归属 & 撞车标」（特色亮点）
在存在共同祖先（`merge_base.is_some()`）时，后端额外计算 `merge-base → Base` 与 `merge-base → Compare` 的改动文件路径集合，为 `files` 中每个文件标注 `change_origin`：

| 枚举值 | 语义 | 展示标记 |
| :--- | :--- | :--- |
| `both` | 两侧相对分叉点均修改了该文件（合并高风险） | 醒目橙色小徽章「两侧均改」（`--warning` 语义令牌） |
| `compare_only` | 仅 Compare 侧相对分叉点修改 | 三点模式下不额外打标（保持清爽）；两点模式下显示轻量 `C` / Compare 标 |
| `base_only` | 仅 Base 侧相对分叉点修改（仅两点快照模式会出现） | 两点模式下显示轻量 `B` / Base 标 |
| `unknown` | 无共同祖先或工作区对比 | 不显示归属标 |

- **一键筛出撞车文件**：在 `CompareStatusFilter` 旁增加「仅看两侧均改 (K)」开关按钮（仅当 `both` 数量 `> 0` 时展示），帮助用户在合并前快速定位潜在冲突文件。
- **兼容性**：路径过滤、状态筛选（A/M/D/R）、扁平/目录树模式切换与「仅看两侧均改」组合生效（AND 关系）。

---

### 3.2 图谱节点悬浮卡精简

参考 VSCode Git Graph 交互风格，收敛触发区域与展示内容：

#### 3.2.1 触发方式收敛
- **仅节点触发**：只在鼠标移入 Graph 列的**提交圆点节点**（含适当透明点击/悬停热区，半径约 `9px`）停留 `220ms` 后弹出悬浮卡；鼠标在提交标题、作者、日期、hash 列移动时**不再触发**。
- 离开节点区域立即取消计时并关闭卡片；滚动、点击、右键时立即关闭。

#### 3.2.2 卡片内容与视觉精简
- **边框呼应**：卡片边框采用当前节点所在泳道颜色（`laneColor(layout.lane)`），视觉上与节点形成强关联。
- **固定三段极简内容**：
  1. **标题行**：`Commit <short_oid>`（居中或左对齐加粗等宽字体）。
  2. **HEAD 包含状态**：
     - 若当前提交在 HEAD 可达范围内：`已包含在 [HEAD]`（或 `已包含在 [<current_branch>]`，detached 时显示 `HEAD`）。
     - 若不在：`未包含在当前分支 [<current_branch>]`。
  3. **所属分支行**：`Branches:` 后以紧凑胶囊展示包含该提交的分支：
     - 同时包含本地分支与远程分支。
     - **同名合并展示**：若同时存在本地 `develop` 与远程 `origin/develop`（且该提交均在两者历史中），合并为一枚分段胶囊 `[ develop | origin ]`；仅远程存在时展示 `[ origin/fix/xxx ]`。
     - 分支过多时最多展示 `8` 枚，超出以 `+N` 胶囊收尾。
- **明确移除**：作者、邮箱、提交/创作时间、父提交 hash、以及所有其他分支的 `gaps` 提交明细列表。

---

## 4. 二期规划（按需演进，不纳入一期交付）

1. **图谱内对比区间着色**：当双槽均已选择且用户切回图谱时，在图谱行上用左右两色细边/浅底色标出 Base 独有提交、Compare 独有提交与分叉点。
2. **提交-文件联动筛选**：在对比页点击左侧某条提交时，支持临时过滤只看该提交触及的文件，而不跳离对比页。

---

## 5. 数据契约与架构改动清单

遵守项目架构边界（契约集中于 `git-core`，Git 计算下沉至 `git-read`，跨进程走 Tauri command，CSS 使用语义令牌，单文件不超过 600 行）：

### 5.1 `crates/git-core/src/dto/compare.rs` & `src/shared/types.ts`
1. **`ChangedFileDto`（或新增对比文件包装）**：
   - 在 `ChangedFileDto` 增加可选字段 `#[serde(default, skip_serializing_if = "Option::is_none")] pub change_origin: Option<CompareChangeOrigin>`（枚举：`both` / `compare_only` / `base_only`），不影响其他非对比场景的序列化。
2. **`CompareResultDto`**：
   - 新增 `pub base_commits: Vec<CommitSummaryDto>` 与 `pub base_commits_truncated: bool`（Base 相对 `merge_base` 独有的提交，最多 `200` 条）。
   - 新增 `#[serde(default, skip_serializing_if = "Option::is_none")] pub merge_base_summary: Option<String>`（供速览卡 tooltip 显示分叉点摘要）。
3. **`CommitBranchContextDto`**：
   - 新增 `#[serde(default)] pub included_in_head: bool`。
   - 新增 `#[serde(default)] pub remote_branches: Vec<String>`（包含该提交的远程分支短名，如 `origin/develop`）。
   - 保留现有 `gaps` 字段以兼容协议，或通过 `limit = 0` 跳过昂贵的 `branch_gap` 遍历，大幅降低节点悬停后端耗时。

### 5.2 `crates/git-read`
- `crates/git-read/src/read/compare.rs`：
  - 利用已有 `merge_base` 与 `stop` 集合，补齐 `base_commits` 遍历（上限 `200`）。
  - 存在 `merge_base` 时计算 `merge_base → base` 与 `merge_base → compare` 改动路径集，为 `files` 填入 `change_origin`（路径级比较，不做内容级 diff，确保性能）。
- `crates/git-read/src/read/detail.rs`：
  - `commit_branch_context` 增加 `included_in_head` 与 `remote_branches` 计算；当 `limit == 0` 时跳过 `branch_gap` 计算。

### 5.3 前端组件与样式
- **对比模块**（`src/features/compare/`）：
  - 拆出独立 `CompareSummaryCard.tsx`（或重构 `CompareHeader.tsx`），实现拓扑结论、双向比例条、分叉点跳转与意图化模式切换。
  - 更新 `CompareCommitList.tsx` 支持 `compare / base` 双向切换。
  - 更新 `CompareFileList.tsx` 与 `CompareStatusFilter.tsx` 支持 `change_origin` 归属标与「两侧均改」筛选。
- **图谱模块**（`src/features/graph/`）：
  - `GraphCell.tsx`：在圆点 `<circle>` 上增加透明命中热区并标记 `data-graph-node` 与 `data-lane`。
  - `GraphList.tsx` & `useCommitHover.ts`：事件委托改为仅识别 `[data-graph-node]`，`commitBranchContext(oid, 0)` 跳过 `gaps` 查询。
  - `CommitHoverCard.tsx`：重构为极简三段式卡片与本地/远程同名分支合并胶囊。
- **国际化与样式**：同步更新 `src/i18n/locales/zh-CN/` 与 `en/`，样式全部使用 `src/styles/tokens.css` 语义令牌。

---

## 6. 验收标准

1. **分支对比 — 第一眼可判断关系**：
   - 快进、落后、分叉、一致、无共同祖先、工作区 6 种场景下，速览卡均能准确展示真实分支名与拓扑状态，不再出现需要心智翻译的抽象提示。
   - 点击分叉点短 hash 可正常跳转回图谱并定位该提交。
2. **分支对比 — 双向完整可见**：
   - 分叉状态下可切换查看 `Compare 独有` 与 `Base 独有` 提交列表；当 Compare 落后于 Base 时，自动默认定位到 Base 独有提交列表。
3. **分支对比 — 撞车文件可秒筛**：
   - 两分支修改同一文件时，文件列表准确标出「两侧均改」，点击筛选按钮后仅显示双侧修改文件；两点快照模式下能区分 `仅 Base` / `仅 Compare` / `两侧均改`。
4. **节点悬浮卡 — 轻快不打扰**：
   - 鼠标在提交文字行、作者、日期列滑过和停留均不弹出悬浮卡；仅移到 Graph 圆点节点上时弹出。
   - 悬浮卡边框颜色与节点泳道色一致，仅展示 `Commit hash`、HEAD 包含状态、合并后的分支胶囊（本地 + 远程）。
5. **工程门禁**：
   - `npm run check`（含前端 `tsc --noEmit`、构建与 Rust 测试）全量通过，新增 `git-read` 单测覆盖双向提交、`change_origin` 与 `commit_branch_context` 远程分支归属。
   - 所有修改及新增文件均满足单文件 `<= 600` 行约束。
