# ADR-0038：分支对比双向差异与节点悬浮卡分支归属契约

- 状态：已接受（2026-11-27 实现）
- 日期：2026-11-27
- 相关：`CompareResultDto`、`ChangedFileDto`、`CommitBranchContextDto`、`git-read`、`src/shared/types.ts`、`docs/03-技术架构.md`

## 背景

1. **分支对比**：当前 `CompareResultDto` 只返回 Compare 侧相对 `merge_base` 引入的提交，Base 侧独有提交不可见；`ChangedFileDto` 不携带相对分叉点的改动归属，无法识别“两侧均改”的高风险文件。
2. **节点悬浮卡**：当前 `commit_branch_context` 只返回本地分支且每次悬停都计算多分支 `branch_gap` 差集明细，既慢又缺少远程分支归属。

## 决策

1. **`ChangedFileDto` 增加可选 `change_origin: Option<CompareChangeOrigin>`**（`both` / `compare_only` / `base_only`），序列化标记 `#[serde(default, skip_serializing_if = "Option::is_none")]`，非对比场景与无共同祖先/工作区对比为 `None`。
2. **`CompareResultDto` 增加 `base_commits`、`base_commits_truncated` 与 `merge_base_summary`**：存在共同祖先时按提交时间倒序收集 Base 独有提交（上限 `DEFAULT_PAGE_LIMIT = 200`）及分叉点首行摘要。
3. **路径级归属判定**：存在 `merge_base` 时，通过 `collect_changes(mb, base)` 与 `collect_changes(mb, compare)` 的路径集合（含 `old_path`）交集计算 `change_origin`，不做内容级三方合并预演。
4. **`CommitBranchContextDto` 增加 `included_in_head: bool` 与 `remote_branches: Vec<String>`**：遍历 `refs/remotes/*`（跳过符号引用如 `origin/HEAD`）补齐远程分支归属；当 `limit == 0` 时跳过 `branch_gap` 计算以降低悬停延迟。

## 影响与边界

- 所有新增字段均带 `#[serde(default)]` 或可选标记，保持现有非对比接口与 IPC 协议向后兼容。
- 仅修改 `git-core` 与 `git-read`，不改变 `graph-layout` 纯函数约束与写操作 Gate。

## 验证

- `cargo test -p git-core -p git-read` 覆盖分叉双向提交、三点/两点 `change_origin`、无共同祖先降级、`included_in_head`、远程分支归属与 `limit == 0` 跳过 `gaps`。
- `npm run check` 全量构建与校验通过。
