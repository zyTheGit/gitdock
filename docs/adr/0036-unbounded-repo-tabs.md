# ADR-0036：仓库标签不设上限与常驻资源池

- 状态：已接受（2026-11-20 实现）
- 日期：2026-11-20
- 相关：ADR-0032（多仓库标签页）、ADR-0002（会话与写互斥）、`docs/03-技术架构.md`
- 修订：ADR-0032 中「标签上限 8 个 / `too_many_repositories`」与「启动恢复逐个 `open_repository`」两处被本 ADR 取代，其余设计不变

## 背景

ADR-0032 给标签数设了上限 8 个，超出返回 `too_many_repositories`。实际使用中标签是用户的工作上下文（主工程、依赖库、实验仓库），8 个上限既无业务依据，也把「想同时保留」变成了「必须先关一个」。上限背后真正需要约束的是**常驻资源**，而不是标签数量本身：

- 每个仓库一个文件监听线程（200ms 轮询 + 350ms 防抖），标签越多线程与句柄越多；
- 启动恢复逐个调用 `open_repository`，每个都读一次完整状态（refs / status / 中断检测），标签多时启动串行变慢；
- 图谱索引磁盘缓存按「每仓 × 每视图 × 每代际」一文件，仓库越用越多时无限堆积。

## 决策

### 1. 移除标签上限

- 删除 `RepoRegistry::ensure_capacity`、`MAX_OPEN_REPOS` 与 `too_many_repositories` 错误码（含前端 i18n key）。
- `open_repository` 只做路径校验与同路径激活，不再拒绝新标签；标签栏 `+` 按钮提示文案去掉「最多 8 个」。

### 2. 文件监听池：按最近激活保留 8 个

- `RepoEntry` 增加 `last_active: AtomicU64`，`set_active` 递增注册表级 `activation_counter` 并写入；关闭活动标签时，接替者同样刷新该戳记，保证新活动标签一定留在池内。
- `AppState::sync_watcher_pool` 按 `last_active` 倒序取前 `WATCH_POOL_LIMIT = 8` 个仓库启动监听，其余停止；`watch_enabled == false` 时全部停止。
- 打开、激活、关闭、启动恢复与设置变更都走同一个 `sync_watcher_pool`，不各自启动监听。
- 池外标签**不发脏点事件**：它们没有监听。激活时 `activate_repository` 一律重新读状态并以返回的 `generation` 为准，同时 `observe/accept` 该代际——正确性不依赖监听，监听只决定「非活动标签能否即时显示脏点」。池容量 8 远大于日常并行工作的标签数，脏点感知的损失可忽略。

### 3. 启动恢复改为单次命令

- 新增 `restore_repositories(paths, active) -> RepoRestoreDto`：
  - 逐个路径登记标签（`resolve_repo_dir` + `GitReadModule::open` + `GitWriteModule::new`），**不读状态、不起监听**；单个路径失败（不存在、非 Git 仓库、权限）记入 `failures`，不阻断其余标签；
  - 只为活动仓库读一次状态；该仓库读取失败时标签保留、状态返回 `None`，延迟到首次切换再读；
  - 结束时同步监听池并静默写回设置。
- 前端 `useRepoTabs.restore` 改为一次调用并整体发布标签列表，不再循环 `open_repository`。启动耗时与标签数基本解耦（登记只做打开仓库句柄）。
- `list_repositories` 仍是标签栏初始化的唯一来源，语义不变。

### 4. 图谱索引磁盘缓存按 LRU 截断

- `git-read` 索引缓存目录保留最多 `CACHE_KEEP_FILES = 64` 个 `*.json`，新文件落盘后按 mtime 淘汰最早写入的；淘汰失败静默（缓存可再生）。
- 缓存键仍是 `sha256(git_dir | view_key | generation)`，内容命中规则不变；截断只影响重算成本，不影响正确性。

## 不变量

- 活动仓库**始终**在监听池内：`set_active` 与 `close` 的接替逻辑都会刷新 `last_active`。
- 代际正确性不由监听保证：所有切换路径都重新读状态、`observe` 并 `accept` 返回的 generation；监听只在代际变化时发 `repository-changed`。
- 关闭标签仍回收该仓库的 watcher 与 PTY；应用退出时全部回收。
- 没有新增任何接收路径参数的 command；`restore_repositories` 的路径来自设置历史，与 `open_repository` 共用同一套规范化与目录校验。

## 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 保留固定上限，只把 8 调大 | 仍是任意数字，且资源随标签线性增长 |
| 每个标签一个监听（不设池） | 线程与句柄随标签数增长，长时间使用会积累轮询开销 |
| 监听池按打开顺序而非最近激活 | 用户会频繁回到最近用的几个仓库，按打开顺序会保留冷标签、停掉热点 |
| 启动时仍逐个 `open_repository` | 每个仓库读完整状态，启动时间随标签数线性增长 |
| 索引缓存不限制 | 长期使用后缓存目录无限增长（每代际一文件） |

## 测试与验证

- Rust：注册表测试打开 12 个仓库不拒绝、重复路径激活不新建；`npm run check` 全绿（169.5 s，含 clippy `-D warnings` 与全部 Rust 测试）。
- 前端：`npm run build` 通过；启动恢复一次命令返回全部标签与活动状态。
- GUI（release exe + WebView2 CDP `9222`）：`restore_repositories` 恢复 8 个标签（活动 `git-graph`）后日志恰为 8 条「已启动文件监听」；经切换器打开 `EvoKit`、`worktree-main` 后标签增至 10、无上限错误、设置同步写回 10 项，新增监听的同时旧监听被停止（`已停止文件监听：pms-common-project`，同时运行数保持 8）；重启后 10 个标签一次恢复；切到池外 `pms-biz-strategy-web` 时其监听被启动、另一旧监听被停止，图谱渲染 29 行；关闭临时标签后标签与设置还原为原 8 项。
