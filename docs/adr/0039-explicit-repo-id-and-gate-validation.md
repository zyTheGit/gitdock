# ADR-0039：多仓库显式 `repo_id` 路由与写前 Gate 校验

- 状态：已接受（2026-11-27）
- 日期：2026-11-27
- 相关：`GateReportDto`、`RepoRegistry`、`commands/read.rs`、`commands/write.rs`、`src/shared/ipc.ts`、`src/app/useWriteFlow.ts`、`docs/03-技术架构.md`

## 背景

ADR-0032 引入单窗口多仓库标签后，大多数读写 command 仍依赖后端隐式读取活动会话（`state.with_session` / `active_entry()`），且 `GateReportDto` 不携带 `repo_id` 与 `generation`。在用户快速切换标签的瞬间，在途的异步读请求、预览或确认框内的 `execute_write` 可能错误路由到新激活的仓库会话，存在跨仓误读与误校验风险。

## 决策

1. **仓库级读写 command 显式支持 `repo_id: Option<RepoId>`**：
   - `src-tauri/src/app/commands/{read,write,settings}.rs` 中所有作用于具体仓库的 command（含 `validate_write`、`execute_write`、`inspect_interruption`、`workspace_status`、`staging_status`、`read_staging_diff`、`read_branch_description`、图谱/详情/对比/搜索/历史/reflog/stash/worktree 等读命令，以及 `read_git_config` / `save_git_config`）统一新增 `repo_id: Option<RepoId>` 形参，内部改走 `state.with_entry(repo_id, ...)` / `state.entry_or_active(repo_id)`。
   - `repo_id` 缺省（`None`）时回退当前活动仓库，保持 CLI / 测试向后兼容。
2. **`GateReportDto` 增加可选 `repo_id` 与 `generation`**：
   - `crates/git-core/src/dto/write.rs` 的 `GateReportDto` 新增：
     - `#[serde(default, skip_serializing_if = "Option::is_none")] pub repo_id: Option<RepoId>`
     - `#[serde(default, skip_serializing_if = "Option::is_none")] pub generation: Option<u64>`
   - `validate_write` 填充实际校验的 `entry.id` 与当时 `generation`；前端 `useWriteFlow` 收到报告时校验其 `repo_id` 与当前活动标签一致，并在 `execute_write` 时显式回传 `gate.repo_id`（若标签已切换则中止，绝不跨仓执行）。
3. **前端单点同步当前活动 `repoId`**：
   - `src/shared/ipc.ts` 维护当前活动仓库标识（`setActiveIpcRepoId`），由 `src/App.tsx` 随 `tabs.activeId` 同步更新，所有仓库级 IPC 调用显式附带 `repoId`。

## 影响与边界

- 仅扩展可选字段与可选参数，不破坏已有无 `repo_id` 的序列化及单仓行为。
- 前端文件级拆出 `src/shared/writeTypes.ts`，避免 `src/shared/types.ts` 超过 600 行红线。
- 仍保持同仓库写互斥、不同仓库可并行执行的既有不变量。

## 验证

- `src-tauri` 单测覆盖多仓库显式 `repo_id` 精确路由不串仓；`git-core` 单测覆盖 `GateReportDto` 的 serde 向后兼容。
- `npm run check`（含 `scripts/check-ipc-args.mjs` 实参/形参核对、`tsc`、`clippy`、`cargo test --workspace`）全量通过。
