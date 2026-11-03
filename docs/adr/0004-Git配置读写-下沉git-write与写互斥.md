# ADR 0004：Git 配置读写收敛到 git-write 与项目级写互斥

- 状态：已接受
- 日期：2026-11-03
- 影响范围：`crates/git-write/src/config.rs`（新增）、`crates/git-write/src/lib.rs`、`crates/git-write/src/description.rs`（注释）、`src-tauri/src/app/gitconfig.rs`（删除）、`src-tauri/src/app/commands/settings.rs`、`src-tauri/src/app/mod.rs`、`docs/03-技术架构.md`
- 触发依据：架构硬规则「Git 知识各归一处」「写操作只在 git-write 的白名单 + Gate 内扩展」；gitconfig.rs 为 726 行超限存量文件（行数只减不增）

## 1. 背景

设置面板的 Git 配置读写自成一格：`src-tauri/src/app/gitconfig.rs` 在 git-read（只读）与 git-write（白名单写）之外自建了第三个 Git 交互入口。它自带 `run_git` 子进程封装执行 `git config --list/--replace-all/--unset-all`，并在 app 层内嵌键白名单（`KNOWN_KEYS` / `CHOICE_KEYS`）、值校验与分支名字符校验（`FORBIDDEN_IN_BRANCH`）等 Git 领域知识，违背「Git 知识各归一处」的模块约定。

更要紧的是并发边界：`save` 是写操作，却完全绕过 `GitWriteModule` 的 `write_lock`。项目级（`--local`）写的是 `.git/config`，与 cherry-pick、暂存、以及同样以 `git config --local` 落盘的分支描述写在理论上是同一批仓库文件的并发写者，互相之间没有任何互斥。

## 2. 决策

### 2.1 下沉范围：核心逻辑纯移动，gitconfig.rs 删除

gitconfig.rs 的实现纯移动到 `crates/git-write/src/config.rs`（公开入口与执行流程、键白名单、`ConfigScope`、DTO、`--show-scope` 输出解析、`--replace-all` / `--unset-all` 命令构造、HOME 注入）；其中取值约束（`CHOICE_KEYS`、长度上限、分支名字符表与 `validate_value` / `normalize`）按职责拆到子模块 `src/config/values.rs`，以满足新文件 400 行规划线。内嵌测试随之迁至 `src/config/tests.rs`（模块子文件，可访问父模块私有项，保持纯移动不改测试逻辑）。app 层 `gitconfig.rs` 整体删除，`commands/settings.rs` 的 `read_git_config` / `save_git_config` command 改调 git-write；依赖方向不变（`src-tauri → git-write` 既有方向，无新依赖边）。

### 2.2 项目级写互斥：与 `execute` 共用同一把锁

`GitWriteModule::save_git_config(scope, repo, entries)` 为有仓库会话时的唯一保存入口。项目级（`Repo`）作用域先 `write_lock.try_lock()`，忙时返回与 `execute` 相同的「已有写操作正在进行，请稍后再试」，再进入既有的「读显式值 → 校验 → 写入 → 回读」流程，持锁覆盖全程。

用户级（`User`）作用域不持锁：它只写用户主目录下的配置文件，与仓库写操作没有共享资源，维持「写操作进行中仍可保存用户级配置」的既有行为。锁的保护范围由此明确为「`.git` 目录的写操作」。

### 2.3 无仓库会话的入口

`git_write::config::save_git_config_without_repo(scope, entries)` 服务未打开仓库的场景：此时只可能保存用户级（项目级由 `save_with_home` 的仓库校验拒绝，`NotARepository` 错误语义与原先一致）；无会话即无并发写操作对象，无需持锁。`read_git_config(repo)` 为自由函数：读取不改仓库状态，无需锁，未打开仓库时也可用。接线由 `commands/settings.rs` 按会话有无分流，两条路径互斥语义不同，均在注释与本 ADR 固化。

### 2.4 归属与封装取舍

- `run_git`（cwd 参数化 + HOME 注入）不复用 `command.rs` 的 `run` / `run_readonly`：二者绑定 `self.root` 且不注入 `HOME`，而配置读写的 `--global` 目标必须由显式 HOME 决定（保证读写目标与界面展示路径一致、测试可指向沙箱）。三者共用 `git_core::git_command` 底座（无窗口标志），HOME 注入作为本模块参数保留。
- `FORBIDDEN_IN_BRANCH` 留在 config 模块（`values.rs`）：唯一使用者是 `init.defaultBranch` 的值校验；`description.rs` 的 `validate_branch_description` 校验的是描述文本值（拒绝 `-` 开头防选项注入）而非分支名，职责相邻但不相同，不抽共享位置。
- 配置 DTO（`ConfigScope` / `ConfigEntryDto` / `GitConfigDto` 等）随实现落在 git-write 而不进 git-core：它们是配置白名单能力的一部分，非跨 crate 共享内核；serde 形状不变，前端零改动。

### 2.5 不变量（不因本 ADR 放宽）

- 键白名单与值校验规则不变：`KNOWN_KEYS` / `CHOICE_KEYS`、控制字符与长度上限、邮箱与分支名字符集检查原样迁移。
- 测试夹具的特殊语义保留：HOME 隔离版 `init_repo`（注入 HOME 隔离用户级配置、不预设 local user.name 以验证两层取值）随迁至 `config/tests.rs`，不收敛至 test-support。
- 命令仍以参数数组启动、不经 shell；`GIT_TERMINAL_PROMPT=0` 不变。

## 3. 备选方案（未采纳）

| 方案 | 行为 | 不采纳原因 |
|---|---|---|
| gitconfig.rs 保留为薄封装转发 git-write | app 层留一个纯转发文件 | 多一层无职责的间接；commands 直接调 git-write 更符合「跨进程只走 Tauri command seam」的装配关系 |
| save 一律持锁（含用户级） | 用户级保存也与写操作互斥 | 用户级文件与 `.git` 无共享资源；持锁只会让「写操作进行中保存用户配置」从可用变为被拒，属无收益的行为回退 |
| DTO 上移 git-core | 契约集中在底座 | 配置键白名单属 git-write 能力而非跨 crate 内核；git-core 不应了解界面配置键 |
| 全局静态锁替代实例锁 | 无会话时也能锁 | 与 per-仓库 `write_lock` 是两把锁，项目级写与既有写操作仍可并发，未修复问题 |

## 4. 后果

- Git 交互入口收敛为两个：读经 git-read，写（含 Git 配置读写）经 git-write；app 层不再出现 Git 命令与 Git 领域知识。
- 行为变化（唯一一处）：写操作进行中保存项目级配置会收到「已有写操作正在进行，请稍后再试」，原先可并发写。
- gitconfig.rs（726 行超限存量）删除；新文件 `config.rs`（375 行）、`config/values.rs`（85 行）、`config/tests.rs`（311 行）均在行数规则内；`git-write/src/lib.rs` 由 40 行增至 41 行。
- 测试归属迁移：13 个配置测试随实现进入 git-write；gitdock-app 测试 58 → 45，git-write 34 → 47，总数不变。
- 后续若扩展配置键或新增作用域（如 `--worktree`），只改 `config.rs` 白名单与校验，并同步前端选项；若出现第二个分支名写校验点，再评估把 `FORBIDDEN_IN_BRANCH` 抽到共享位置。