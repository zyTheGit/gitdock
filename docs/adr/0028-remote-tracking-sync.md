# ADR-0028：远端跟踪同步（上游计数、检出、首推、标签推送与 prune）

- 状态：已采纳（2026-11-20）
- 关联：T08、ADR-0002（dirty 切换）、ADR-0010（远程操作）、ADR-0011（pull / rebase 语义）、ADR-0022（远程删除）

## 背景

远程能力有四个日常断点：侧栏分支看不到相对上游的 ahead/behind；新建分支首次 Push 被 Gate 以「没有上游」拒绝，无法在界面内完成 `git push -u`；远程分支无法一键检出为跟踪本地分支；标签只能删远程不能推远程，且远端删除的分支缺少 `fetch --prune` 清理入口。本 ADR 定稿这四项的契约与安全边界。

## 决策

### 1. 上游计数落在 git-read（纯 gix）

- `RefDto` 增加可选字段 `upstream` / `ahead` / `behind`（`skip_serializing_if` 缺省省略，旧前端不受影响）。
- 计数在 `crates/git-read/src/read/upstream.rs` 内完成，只读、零子进程：
  - 只处理 local config 中 `branch.<name>.remote` 与 `branch.<name>.merge` 同时存在、且 `merge` 指向 `refs/heads/...` 的分支；tag / 裸 OID 上游没有 ahead/behind 语义，跳过。
  - 用 merge-base + 有界 rev walk 数两侧提交；单侧上限 500（`MAX_UPSTREAM_COMMITS`），参与计数的分支上限 200（`MAX_UPSTREAM_BRANCHES`）。
  - 超限、引用缺失或任何单分支错误一律返回 `None`（只展示上游名，不展示计数），绝不让 `open_repository` 失败或明显变慢。
- 计数不进入 generation 之外的缓存；每次 `read_refs` 按当前引用现算。

### 2. 四个新写操作（WriteKind 白名单）

| kind | 字段 | 命令（参数数组） | Gate 要点 |
|---|---|---|---|
| `checkout_remote_branch` | `branch`=远程跟踪短名（如 `origin/feat-a`），`new_name`=可选本地名 | `git switch -c <local> --track refs/remotes/<branch>` | 必须含 `/` 且远程跟踪引用存在；本地同名分支不得存在；dirty 语义复用 ADR-0002 的 switch 共享校验（只 warning + 受影响路径，由 Git 判定覆盖风险）；unborn / detached / 冲突索引拒绝 |
| `push_set_upstream` | `branch`=当前本地分支，`remote`=可选 | `git push -u <remote> <branch>` | 必须当前检出该分支、无上游、非 unborn/detached；remote 按 §3 解析；已有上游时提示直接 Push |
| `fetch_prune` | 无 | `git fetch --prune` | 同 `fetch`：只要求存在远程 |
| `push_tag` | `branch`=标签名（复用 `branch` 字段，保持旧请求兼容），`remote`=可选 | `git push <remote> refs/tags/<tag>` | 标签名合法且本地存在；不提供 `--force` / `--delete` |

- `WriteRequest` 新增可选 `remote` 字段（`skip_serializing_if`），只有 `push_set_upstream` / `push_tag` 使用。
- 执行仍走 `validate_write` / `execute_write` 泛化通道，不新增 Tauri command。
- 不提供 force / force-with-lease 推送；不记录、不询问任何凭据（沿用系统凭据管理器与 SSH agent，见 ADR-0010）。

### 3. remote 选择策略（Gate 与执行一致）

`remote::select_remote(requested, available)`：

1. 显式传入且已配置 → 使用；
2. 显式传入但未配置 → `gate_remote_unknown`（args 列出已配置项）；
3. 未传入且存在 `origin` → 使用 `origin`；
4. 未传入、无 `origin`、恰好一个远程 → 使用该远程；
5. 未传入、无 `origin`、多个远程 → `gate_remote_ambiguous`（args 列出候选），要求前端显式选择；
6. 没有任何远程 → `gate_remote_missing`。

Gate 摘要（`summary_key` + args）始终展示最终 remote 与分支/标签名，确认框据此显示。

### 4. 检出本地名的规则

- 未提供 `new_name` 时取远程跟踪短名去掉 remote 前缀后的分支名（`origin/feat-a` → `feat-a`）。
- 本地名与远程名都要通过 `is_safe_name`：非空、不以 `-` 开头、不含空白/控制字符、不出现 `..` / `~` / `^` / `:` / `?` / `*` / `[` / `\` 等非法形态；非法即 `InvalidArgument`，不拼进命令。
- 命令固定 `--track` 完整 `refs/remotes/...`，不依赖 `--guess`。

### 5. 明确不做

- 不引入 `pull --rebase` 的新交互路径；现有 `pull` 已支持 `PullMode::Rebase`，但「历史改写确认」仍按 ADR-0011 的确认框语义执行，本任务不改变其确认流程。
- 不做多 remote 的增删改界面；只在 Gate 报错里列出候选。
- 不清理本地分支、不删除远程引用之外的任何东西；`--prune` 只由用户显式触发的 `fetch_prune` 执行。

## 影响

- 契约：`RefDto`、`WriteRequest`、`WriteKind`（31 → 35）同步 `src/shared/types.ts`。
- 模块：`git-read/read/upstream.rs`（新增）、`git-write/remote.rs` + `remote/gate.rs`（扩展），docs/03 白名单与模块表同步。
- 测试：`crates/git-read/tests/read_upstream.rs`（有/无上游、计数与缺省）、`crates/git-write/tests/write_remote.rs`（检出、首推、prune、标签推送与拒绝路径）。

## 验证

- `cargo test -p git-write -p git-read` 全绿（write_remote 与 read_upstream 纳入）；
- `cargo clippy … -D warnings`、`npm run check` 全部门禁通过，所有触及文件 ≤ 600 行。
