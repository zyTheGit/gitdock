# ADR-0032：多仓库标签页（Multi-Repo Tabs）

- 状态：已接受（T12A）；部分修订见 ADR-0036
- 日期：2026-11-20
- 相关：ADR-0002（会话与写互斥）、ADR-0010（远程写）、ADR-0029（重置与 Reflog）、ADR-0036（标签不设上限）、`docs/03-技术架构.md`

## 背景

现有 `AppState` 只有一个 `session`、一个 `RefreshCoordinator`、一个 `RepositoryWatcher` 与一个全局 PTY 注册表；打开新仓库会关闭旧仓库的终端并替换会话。用户在多仓库间来回切换（例如主工程与依赖库、工作仓库与实验仓库）必须反复「关闭 → 打开」，图谱范围、选中提交、对比槽位全部丢失，终端进程也会被终止。

本 ADR 将单会话升级为同一窗口内的多仓库标签页，保持现有 command 签名与前端单仓数据流不变：标签切换只改变「活动仓库」，读写命令缺省作用于活动仓库（与当前行为一致），不需要给 40 余个 command 增加 `repo_id` 参数。

## 决策

### 1. 后端：仓库注册表 + 活动仓库

`src-tauri/src/app/state.rs`：

```text
RepoId = u64（进程内单调递增，从 1 开始；仓库关闭后不复用）

RepoEntry {
    id: RepoId,
    path: PathBuf,                 // 规范化后的仓库路径
    session: Session,              // 既有 GitReadModule + GitWriteModule（每仓一个写锁）
    refresh: Mutex<RefreshCoordinator>,   // 每仓独立 generation
    watcher: Mutex<Option<RepositoryWatcher>>, // 每仓独立监听
    opened_at: u64,                // 打开顺序，用于关闭活动标签后选择接替者
}

AppState {
    repos: RwLock<HashMap<RepoId, Arc<RepoEntry>>>,
    active: RwLock<Option<RepoId>>,
    ...（settings / terminals / paths 不变）
}
```

- 删除原 `session: RwLock<Option<Session>>`、`refresh: Mutex<RefreshCoordinator>`、`watcher: Mutex<Option<RepositoryWatcher>>` 三个单仓字段。
- `with_session(f)` 解析活动仓库后执行，**所有既有读/写 command 与 app 内调用点保持原签名**；活动仓库为空时仍返回 `errors.repoNotOpen`。
- `request_refresh` / `observe_generation` / `accept_generation` 改为在活动仓库的 `RefreshCoordinator` 上操作；写操作完成后的刷新只作用于发起写的仓库（写互斥由每仓 `GitWriteModule` 承担，跨仓可并行）。
- 同一路径再次打开视为「激活已有标签」：复用 `RepoEntry`，不重建模块、不重启监听。

### 2. 监听与事件

- `watch::start` 接收 `Weak<AppState>`、`Arc<RepoEntry>` 与 `repo_id`；事件载荷 `RepositoryChangedDto` 增加 `repo_id: RepoId` 字段（serde 兼容旧字段）。
- 事件仍只在代际变化或元数据变化时发出；前端按 `repo_id` 路由到标签页，非活动标签只标脏（显示脏点），不拉取图谱。
- 关闭标签页时 `RepositoryWatcher` Drop 停止线程，并从 `repos` 移除；应用退出时全部停止。

### 3. 终端

- `TerminalRegistry` 的每个会话记录 `repo_id`；`terminal_open` 的工作目录取**活动仓库**（契约不变），`close_for_repo(repo_id)` 在关闭标签时回收该仓库的全部 PTY。
- 切换活动标签**不再**结束任何 PTY；只有关闭标签才回收对应仓库的会话。
- 前端保持每个标签的终端面板实例挂载（非活动标签 `hidden`），xterm 缓冲区因此不丢失；PTY 本体始终由 Rust 持有。

### 4. Command 契约（新增 4 个，其余不变）

| Command | 返回 | 语义 |
|---|---|---|
| `open_repository(path)` | `RepoStateDto` | 打开或激活该路径的标签；成功后成为活动仓库。标签数不设上限（ADR-0036 移除原 8 个上限）。**不再关闭其他仓库的终端与监听。** |
| `list_repositories()` | `RepoListDto { repos: RepoTabDto[], active: Option<RepoId> }` | 启动恢复与标签栏初始化的唯一来源；`RepoTabDto { repo_id, path, name, is_active }`（`name` 取目录名）。 |
| `activate_repository(repo_id)` | `RepoStateDto` | 切换活动仓库；返回该仓库最新状态（含中断态）。未知 id 返回 `repository_not_found`。 |
| `close_repository(repo_id?)` | `Option<RepoStateDto>` | 关闭标签：停止监听、回收 PTY、移除 entry；若关闭的是活动标签且仍有其他标签，按 `opened_at` 选择最近打开的接替并返回其状态；没有剩余标签时返回 `None`。`repo_id` 缺省表示当前活动标签，兼容未升级的调用方。 |

- 前端标签栏显式传 `repo_id`；旧调用（无参）仍关闭活动标签，避免升级过程中命令缺失。
- 应用启动时**不自动打开**任何仓库；恢复逻辑在前端（见 §5）。启动恢复由 ADR-0036 改为单次 `restore_repositories`，不再逐个 `open_repository`。
- `RepositoryChangedDto.repo_id`、`RepoTabDto` 是 app 层 DTO（`src-tauri/src/app/state.rs` 或 `commands/repo.rs`），不进入 `git-core`。

### 5. 启动恢复（前端）

- `SettingsDto` 新增：

```text
open_repositories: Vec<String>   // 上次打开的全部仓库路径（打开顺序）
active_repository: Option<String> // 上次活动仓库路径
```

两个字段由 app 在 open / activate / close 后静默写回（沿用 `remember_repository` 的写法，不经过设置弹窗草稿）。仅当 `restore_last_repository == true` 时，启动后调用一次 `restore_repositories(paths, active)`（ADR-0036）：标签一次登记，只有活动仓库读状态；单个路径失败（被删除、权限不足）跳过并记录提示，不阻断其余标签。

### 6. 前端标签状态

- 新建 `src/app/useRepoTabs.ts`：`tabs: RepoTabDto[]`、`activeId`、`open(path)`、`activate(id)`、`close(id)`、`restore()`；调用后端 command 并维护顺序。
- 新建 `src/app/RepoTabBar.tsx`：顶部标签条，显示仓库名、脏点（收到非活动标签的 `repository-changed`）、关闭按钮与 `+`（复用现有仓库选择对话框）。
- 每个标签的 UI 视图态保存在内存（不持久化）：`scope`、`selectedOid`、`compareSlots { base, compare }`、`mainMode`（graph / compare / detail）、图谱滚动位置。切换时先快照当前标签，再恢复目标标签并以其活动仓库重新拉取数据；`repository_state` 成功后以返回的 `generation` 为准。
- 页面级快捷键（Esc、Alt+↑/↓、搜索等）只作用于活动标签；非活动标签的终端面板不接收按键。

## 不变量与安全边界

- 前端仍不能传任意路径给读写 command；标签栏路径只能来自用户选择或设置中的历史路径，且每个命令仍限制在对应仓库内。
- 写互斥按仓库生效：同仓串行、跨仓并行；Gate 与中断态判定只看目标仓库。
- 每仓 generation 独立，标签切换不得让一个仓库的过期结果覆盖另一个仓库的 UI。
- 关闭标签必须同时停止 watcher 与 PTY；应用退出时全部回收，避免孤儿进程与句柄。
- 终端工作目录仍取活动仓库会话，不接受前端路径。

## 测试与验证

- Rust：注册表单元测试（打开/激活/关闭、重复路径复用、关闭活动标签后接替顺序；上限拒绝用例已按 ADR-0036 移除）；写入与终端 `close_for_repo` 的隔离测试；事件载荷包含 `repo_id`。
- 前端：`npm run build`；标签增删、切换后 scope/选中/对比槽位恢复；非活动标签脏点；关闭标签后 `list_repositories` 不再包含该项。
- GUI（release exe + WebView2 CDP）：仓库 A 打开终端，切到仓库 B 看对比，再切回 A 验证终端输出仍在、图谱滚动位置与对比槽位完好；关闭 A 后任务管理器中无残留子进程。

## 不在范围内

- 多窗口、跨窗口标签拖拽、标签排序持久化。
- 每个标签独立的设置/主题/快捷键。
- 一次性为所有 command 增加显式 `repo_id` 参数（未来确有需要时再引入，作为 ADR 修订）。
- 标签上限之外的分组、收藏与工作区概念。
