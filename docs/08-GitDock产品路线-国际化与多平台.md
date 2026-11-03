# GitDock 产品路线：Git 能力、国际化与多平台

> 状态：产品/架构规划基线，后续实现前需按阶段冻结验收标准。
> 产品定位：GitDock 是面向日常开发的 Git 桌面工作台；Git Graph 是其中的历史图谱模块。
> 命名：GitDock 为当前产品名。设置入口统一收进菜单栏；截至 2026-11-03，当前版本已发布，已知问题已修复。

## 1. 产品目标与复杂度原则

长期目标是覆盖开发者日常 Git 工作流，同时为低频和高级操作提供入口。产品完整度不以按钮数量衡量：常用流程由清晰的原生界面完成；低频高级流程通过折叠的“高级操作”呈现；尚未原生支持的操作可在当前仓库上下文中打开内置 LazyGit/Shell。

界面遵循三层信息架构：

1. **日常操作**：状态、图谱/历史、提交详情、暂存区、提交、分支/标签、stash、文件对比。
2. **高级操作**：远程同步、merge/rebase、批量 cherry-pick 等，以场景化页面逐步增加，提供预检查、影响说明、确认和恢复路径。
3. **终端工作区**：覆盖原生界面暂未支持的 Git 操作；不试图解析或拦截所有终端命令。终端操作完成后通过文件监听与 RefreshCoordinator 更新 UI。

默认主界面只呈现高频任务；高级命令按上下文出现，详细诊断可展开；快捷键可查阅和配置；所有改变仓库状态的能力按风险级别设计确认与恢复。通用第三方插件 API 暂缓，先将内部能力按可扩展模块组织，避免过早承诺插件权限、兼容性和分发政策。

## 2. 需求规格

### R1：Git 工作流覆盖

- 在现有仓库视图、提交详情、双槽对比、搜索、分支描述、暂存区、Cherry-pick/Revert 和终端工作区基础上，逐步覆盖状态、提交、分支/标签、stash、远程同步、merge/rebase 等常用 Git 流程。
- 每项新增 Git 写能力必须定义：前置状态、影响对象、命令语义、用户确认、结果状态机、冲突/失败恢复、刷新策略和 Given/When/Then 验收项。
- 复用 LazyGit/Shell 作为暂缺能力的过渡入口；用户始终在 GitDock 当前仓库上下文中工作。
- 对危险操作按需显示在“高级操作”，并清楚解释影响；不因追求功能数量把所有操作堆进顶栏。
- 插件市场与任意第三方代码执行不属于近期路线。开放插件前需单独决策权限模型、签名/来源、版本兼容、崩溃隔离和数据访问范围。

### R2：中文与英文

- 产品 UI 首期支持简体中文与英文，包含菜单、设置、状态、确认框、错误提示、空态、快捷键说明、终端集成指引和 Issue 模板。
- 首次启动默认跟随操作系统语言；系统语言为中文时用简体中文，英文或不支持语言时回退英文。用户可在设置中覆盖并持久化选择。
- 语言切换即时生效，不重启；Git 原始输出、提交信息、路径、分支名、配置值和用户内容保持原文，不翻译数据。
- 日期、时间、数字按当前语言格式化；布局支持字符串长度增长，禁止依赖固定英文文案宽度。
- 新增可见文本必须来自集中式消息资源，缺少翻译时构建/检查可发现；错误码与用户文案分离，Rust 返回稳定错误标识与参数，由前端本地化呈现。

### R3：macOS 与 Linux

- 维持 Windows 为持续支持平台，并逐步新增 macOS 与 Linux 桌面支持；三平台共享 Git 领域逻辑、DTO、React 视图和终端交互。
- 首期 macOS 支持 Apple Silicon 与 Intel（若 CI/依赖能稳定构建），发行 DMG；需验证签名、公证和首次启动指引。
- 首期 Linux 支持范围以 Ubuntu LTS x86_64 为主，先交付 AppImage 或 deb 中经 Spike 选定的一种主格式；其他发行版列为社区/实验支持，明确系统库前置条件。
- 各平台的 Git、Shell、URL 打开、文件选择、PATH 搜索、进程隐藏/信号处理、配置目录、文件监听和打包行为放在 Rust 平台适配层；业务 crate 不包含 OS 分支。
- 平台支持状态使用“开发构建通过 / CI 构建通过 / 实机验收通过 / 正式发布”逐级标记，不把交叉编译成功视为平台支持完成。

### R4：版本、设置和发布

- 设置入口统一位于菜单栏；设置中的语言、外观、终端、Git 操作、快捷键和关于区域遵循当前设置分区模式。
- 版本号继续由 `npm run bump` 统一维护；每个平台发行包显示相同版本号，Issue 预填产品版本与 OS，不自动包含仓库路径或日志。
- 版本更新、Issue 页面、下载页采用平台中立 URL；安装/更新流程因平台而异，分别验证。

## 3. 技术方案

### 3.1 模块与 seam

维持 `git-core` / `git-read` / `git-write` / `graph-layout` / `refresh` 的依赖方向。新增平台差异通过 `src-tauri` 的平台适配层收敛：

```text
React UI + message catalog
        │ stable DTO / Tauri command seam
src-tauri app orchestration
   ├── platform adapters (process, shell, paths, URL, dialogs, packaging)
   ├── GitReadModule ── gix
   ├── GitWriteModule ── Git CLI
   ├── TerminalHost ── PTY / platform shell
   └── RefreshCoordinator
```

模块接口保持稳定，平台实现作为 adapter 注入。`git-read`、`git-write` 不直接依赖 Tauri UI；前端不含平台路径和 Git 命令。每个新 seam 应有真实的多个平台实现或可替换实现需要，不提前抽象没有变体的逻辑。

### 3.2 国际化实现

- 增加 `src/i18n/` 消息资源（`zh-CN`、`en`）、类型安全的消息 key 和统一 `t()` / 格式化入口；按功能域拆分资源，避免单文件膨胀。
- 抽取 React 中可见硬编码文案；Rust DTO 传递稳定 `ErrorCode`、插值参数和原始诊断，前端根据语言生成说明。
- 系统语言探测放在应用启动层；设置覆盖写入 settings schema（新增字段须支持旧配置默认值）；文案切换时保留当前视图和用户输入。
- 对 Shiki 语言标识、Git 文件路径和提交内容，不套 UI 翻译；语言切换只影响界面文案和格式化。
- 自动化检查扫描 JSX/TSX 的用户可见文本；人工验收检查英文长文案、窗口缩放和窄布局。

### 3.3 跨平台适配

以 `PlatformAdapter` 作为 `src-tauri` 内部 seam，首批职责：

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| Shell 默认值 | PowerShell | 用户默认 shell（登录环境路径） | 用户默认 shell（登录环境路径） |
| 终端 PTY | portable-pty / ConPTY | portable-pty / Unix PTY | portable-pty / Unix PTY |
| URL 打开 | 当前受限实现 | 系统默认浏览器 adapter | 系统默认浏览器 adapter |
| 文件选择 | Tauri dialog | Tauri dialog | Tauri dialog，验发行版集成 |
| 进程退出 | Windows job/process 管理验证 | Unix signal/子进程组 | Unix signal/子进程组 |
| 配置/缓存目录 | Tauri app dirs | Tauri app dirs | Tauri app dirs |

不得将 Shell 名称、URL opener、路径规则散落在 commands 或 React 中。Git 命令仍参数数组启动；终端执行权限如同用户 Shell，界面应持续可见地说明这一点。

### 3.4 Git 功能扩展

- 继续以 `GitWriteModule` 白名单操作和 Gate 为唯一仓库写 seam；每个新操作有专用 DTO/稳定错误码，不开放前端通用命令执行。
- 按“状态/提交/分支与标签/stash/远程同步/merge-rebase”分域规划；高风险操作作为独立 ADR 与交付阶段。
- LazyGit 集成复用现有 TerminalHost，保持可选且不捆绑二进制；仓库变化通过 watcher + RefreshCoordinator 同步。
- 插件化先体现在内部模块注册/命令贡献机制的设计原则，不提供动态加载第三方代码能力。

### 3.5 构建与发行

- CI 至少设 Windows、macOS、Ubuntu LTS 三个平台构建矩阵；功能测试按平台执行适配层测试，端到端实机验收覆盖原生终端、文件选择和仓库操作。
- macOS 发布要求签名与 notarization；Linux 明确系统依赖及主包格式；Windows 沿用现有 NSIS/MSI 策略。
- 版本 bump 检查、依赖/许可证清单、打包大小、更新链接和 Issue 环境信息必须进入发布检查表。
- Tauri 官方说明 Linux 开发需要 WebKitGTK 等系统依赖，分发支持 AppImage、deb、Snap、Flatpak、RPM 等格式；macOS 直接分发需要代码签名与 notarization。因此首发支持范围应以 CI + 实机 + 安装升级验证为准。[平台前置条件](https://v2.tauri.app/start/prerequisites/)、[分发方式](https://v2.tauri.app/distribute/)、[macOS 签名与公证](https://v2.tauri.app/es/distribute/sign/macos/)

## 4. 任务拆分

### G0：当前版本交接清理

1. 将交接文档中的“未 push/CI 尚未首次通过”等状态更新为已发布后的真实情况。
2. 更新 `docs/06-GitDock后续需求与执行计划.md`：标记 A–D 已完成并指向本文件；旧持续提示词不再作为当前执行计划。
3. 设置入口移入菜单栏列为已决定的 UI 收敛任务，补验收/交接状态；若已随发布完成，记录版本与提交。

完成标准：README、交接、06 计划、发布说明中的状态一致，无过期提示词指向已完成任务。

> G0 状态（2026-11-03）：已完成。`docs/05` 头部与 1.1 已同步发布/CI 实况（`main` 已推送，CI 门禁通过，v0.1.0–v0.1.2 经 Release 工作流发布），待决策 2（设置入口收进菜单栏，已裁决为既定方向、待实现）与 3（push/CI，已完成）闭环，第 9 节提交历史补齐并去除“未 push”；`docs/06` 头部与第 6 节均标注过期并指向本文件。设置入口收进菜单栏的实现独立于 G0 文档清理，当前仍为顶栏设置按钮（`src/app/TopBar.tsx`），建议随 G1 菜单文案一并设计验收。

### G1：国际化基础

1. 盘点前端可见文案与 Rust 用户错误，形成消息域清单。
2. 选择并记录 React/TypeScript 本地化实现；为 zh-CN/en 建消息资源与类型安全入口。
3. 实现系统语言默认、用户覆盖、持久化、即时切换与旧设置迁移。
4. 迁移公共壳、导航、设置、错误横幅、对话框、暂存、终端和更新/关于文案。
5. 加入遗漏硬编码扫描、英文长文本布局验收和中英 UI 验收。

完成标准：所有当前可见静态 UI 文案均可中英切换；动态 Git 原始内容不被翻译；设置重启后保持；没有缺失 key/回退到裸 key。

> G1 状态（2026-11-03）：**已完成并合并 main**（`feature/g1-i18n` 全部提交经快进合并为 `0612d08`）。任务 1–10 全部交付：i18next + react-i18next（MIT）基础设施、前端 13 个消息域（common/shell/repository/graph/detail/diff/search/compare/staging/terminal/settings/write/errors）约 745 个 key、类型安全 key 与 zh/en 同构校验、语言跟随系统/设置覆盖/即时切换/持久化（`set_language` 命令）；Rust 全部用户文案载体（UserVisibleError/GateIssueDto/WarningDto/WriteOutcomeDto/GateReportDto.summary/FileDiffDto.note）采用「中文 message 兜底 + i18n key/args」渐进式契约，`GraphPageDto.scope`/`CommitDetailDto.baseline` 枚举驱动前端翻译；`scripts/check-i18n.mjs` 门禁进 `npm run check`；英文长文本/窄窗口/缩放布局人工 GUI 验收通过（2026-11-03 用户确认；验收中发现并修复 2 项：Git 配置 Reload 交互反馈、图谱范围标签中文直出）。已知权宜（详见 docs/05）：`gate_interrupted` 的 kinds/hint 中文 join（罕见场景）；FeedbackDialog Issue 模板语言待产品裁决。

### G2：跨平台准入 Spike

1. 盘点 Windows 专属代码、依赖、命令行参数、Shell、文件监听、URL/文件对话框、配置目录与打包脚本。
2. 在 macOS 与 Ubuntu LTS 建立 Tauri dev/release 编译和 CI 最小矩阵。
3. 逐项验证 Git 读取/写入、SHA-256（如环境支持）、PTY/Shell/LazyGit、中文路径、文件监听、设置迁移和 Issue/更新链接。
4. 选定 macOS CPU 架构、最低系统版本；Linux 主发行版、CPU 架构、系统依赖与首发包格式。
5. 输出缺口、适配工作量、发行阻塞（证书/公证/包仓库）与 go/no-go。

完成标准：两平台均有 CI release 构建，至少一个实机或原生 runner 安装验证；支持矩阵和已知限制由产品确认。

> G2 进度（2026-11-03，已合并 main，PR #2 / `f36ddd0`）：第 1、2、4、5 项完成——① 差距清单 `docs/09-G2-跨平台差距清单.md`（A/B/C 分级、i18n 平台文案 14 key、约 5-8 人日预估、go 倾向）；② **CI 三平台矩阵在 main 全绿**（verify job：windows-latest / ubuntu-22.04 / macos-latest 均跑完整 `npm run check`，含 Linux apt 前置；首跑曾暴露 2 处非 Windows unused import——CI 矩阵的实证价值，已修复）；release.yml 已多平台化（build matrix + publish 两段式）但未触发过；④ 平台范围已裁决（macOS Apple Silicon 优先 / Ubuntu 22.04 LTS x86_64 基线 / 包格式 G5 比选，docs/08 裁决点 1-3 均闭环）；⑤ 发行阻塞已记录（macOS 签名/公证归 G4、AppImage WebKitGTK 兼容归 G5）。**未完成**：第 3 项逐项功能验证（Git 读写/PTY/中文路径/监听等，docs/09 §6 清单，需实机或原生 runner 安装运行；「至少一个实机或原生 runner 安装验证」的完成标准未达——CI 编译测试通过 ≠ 安装验证）；macOS/Linux dev 构建与 GUI 运行未在实机执行。**不宣称 macOS/Linux 支持**（开发构建/CI 构建通过级别，docs/09 §6 验证后按 R3 四级标记推进）。

### G3：平台适配层与构建

1. 建立 `PlatformAdapter` 内部 seam，并迁移 Shell 解析、URL opener、OS 环境、进程退出、路径处理。
2. 让 Rust 核心 crates 在 Windows/macOS/Linux 构建与测试；消除不应存在于领域层的 OS 条件分支。
3. 补齐平台配置目录、文件监听、Git 可执行文件发现和终端能力差异。
4. 配置三平台 CI、依赖缓存、许可证/供应链检查与 release artifact 归档。

完成标准：三平台 CI 通过；各平台 adapter 有对应测试；无平台私有逻辑泄漏到 React 或 Git 领域 crate。

> G3 进度（2026-11-03，分支 `feature/platform-adapter`，提交 `bbd8ba4`/`cdea6f0`）：第 1 项完成——ADR-0005 落地 `src-tauri/src/app/platform/`（shell/url/paths/tools 按 cfg 分派纯函数），四个消费文件（terminal/external/config.tools/config.recent）OS 专属细节收敛至 platform 模块、业务文件 cfg 清零；差距清单 A 级 4 项中 3 项修复（Shell 跨平台 A-1、工具探测 A-2、路径比较 A-3），A-4（Unix 进程组回收）经 ADR 决策延后至实机验证（G4/G5）。第 2 项：三平台 CI 矩阵 main 已全绿（G2 成果延续），领域 crate 零 OS 分支维持。第 3 项：配置目录/文件监听/Git 发现/PTY 经调查确认为平台中立（C 级），终端 Shell 能力差异已由 platform::shell 补齐。第 4 项：三平台 CI + rust-cache 缓存就绪，release artifact 归档（upload-artifact 两段式）就绪，**许可证/供应链检查本轮新增**（deny.toml + ci.yml licenses job，cargo-deny-action licenses+advisories；notify 的 CC0-1.0 显式允许）——licenses job 待推送后 CI 首跑验证。前端配套：`src/shared/platform.ts`（AppInfoDto 注入）、TerminalPanel metaKey 全屏键与 LazyGit 安装指引三平台化、i18n 平台文案 14 项处理、**快捷键 ⌘ 完整支持（ADR-0006 显示层映射方案：存储规范不变，macOS 监听并入 ctrl、显示 ⌘）**。**G3 剩余**：licenses job CI 首跑验证（随分支推送）；macOS/Linux 运行时行为（Shell/⌘/探测/显示）属 G4/G5 实机验收项——CI 编译与测试通过不代表运行时验证完成。

### G4：macOS 公开支持

1. 验证 Apple Silicon，评估 Intel 发行需求；确认最低 macOS 版本。
2. 完成 DMG/App bundle、签名、公证、首次启动提示、升级和卸载路径。
3. 实机验收中文输入法、PTY resize、快捷键、文件选择、打开外部工具、仓库路径含空格/Unicode、休眠恢复。
4. 将 macOS 支持等级由 CI 构建提升到正式发布。

完成标准：签名/公证安装包完成全新安装与升级验收，用户无需命令行绕过安全提示即可启动。

> G4 进度（2026-11-03，分支 `feature/g4-macos-prep`，本地准备阶段）：已落地的本地可逆准备——① `tauri.conf.json` 新增 `bundle.macOS.minimumSystemVersion: "10.15"`（WKWebView API 基线；未经实机验证的声明性取值，G4 实测后冻结）；② release.yml 的 Release 说明自动附加未签名平台指引（macOS Gatekeeper 右键打开/`xattr -cr`、Linux AppImage 需 libfuse2）——G4 第 2 项「首次启动提示」的发布渠道部分。**G4 前置条件（均未满足）**：① 多平台 release.yml 构建链路从未运行（需授权 bump + prerelease tag 首跑验证，同时满足 G2 安装级验证）；② Apple Developer Program 账号与 Developer ID Application 证书（签名/公证必需，$99/年，用户资源）；③ macOS 实机（Apple Silicon 已裁决优先）执行第 3 项逐项验收。**在 ①③ 完成前 macOS 保持「CI 构建通过」级，不宣称支持。**
>
> **G4 约束更新（2026-11-03，用户确认无 Apple Developer 账号）**：签名/公证不可执行，G4 原完成标准（「用户无需命令行绕过安全提示即可启动」）**在当前资源下不可达**。路线调整方向待产品裁决：macOS 目标等级可降为「未签名实验性支持」（未签名 DMG + 实机验收 + 发布说明绕过指引，不计入正式支持），G5 Linux（无账号门槛）相应提前为首个正式多平台发布；或待未来购买账号后回补签名/公证。无论何种调整，Apple Silicon 优先、Intel 延后的架构裁决不变。

### G5：Linux 首发支持

1. 以 Ubuntu LTS x86_64 为目标基线，选择 AppImage 或 deb 作为首发格式。
2. 明确并展示 WebKitGTK 等运行依赖；检查桌面环境下文件选择、URL 打开、系统主题、剪贴板、图标与托盘差异。
3. 验证 PTY/Shell、中文路径、仓库文件监听、权限和安装/升级/卸载。
4. 记录其他发行版支持等级；不承诺未验证发行版兼容。

完成标准：目标发行版全新安装、升级和卸载通过；系统依赖说明清楚；正式发布 artifact 可复现。

### G6：Git 能力扩展

按独立阶段交付：提交创建/修改、分支与标签管理、stash、fetch/pull/push、merge/rebase/批量序列。每阶段先定语义与 ADR，再分读路径、Gate/执行器、UI、冲突/恢复、验证和文档子任务。远程凭据不得被应用记录；历史改写和破坏性操作必须有专门确认和恢复说明。

完成标准：每个操作在 GitWriteModule 白名单内；成功/失败/冲突/中断状态清晰；工作区与 refs 的实际状态经过独立测试验证；对应文档和支持平台矩阵同步。

## 5. 顺序与依赖

```text
G0 交接状态清理
 ├── G1 国际化基础 ───────────────┐
 └── G2 跨平台 Spike → G3 平台层 ─┴→ G4 macOS → G5 Linux
                                      │
                                      └→ G6 Git 功能持续按独立 ADR 穿插
```

建议先并行做 G0 与 G1 的文案盘点；G2 可在 G1 设计完成后并行。国际化基础和平台 seam 应先于大量新增 Git UI，以免新文案和 OS 代码继续扩散。

## 6. 风险与产品裁决点

尚需在实现各阶段前确认：

1. ~~中英文首发语言策略~~ **已确认（2026-11-03）**：系统语言默认、设置可覆盖；缺失翻译时**中文兜底**（用户裁决，G1 已按此实现）。
2. ~~macOS 是否首期同时支持 Apple Silicon + Intel~~ **已确认（2026-11-03）**：优先 Apple Silicon（aarch64），Intel 延后到 G4 评估（Rosetta 2 / universal2）。
3. ~~Linux 是否接受首期只正式支持 Ubuntu LTS x86_64 与单一包格式~~ **已确认（2026-11-03）**：接受；基线 Ubuntu 22.04 LTS x86_64（glibc 2.35），CI 双格式产出（AppImage + deb）供 G5 实机比选后定主格式，其他发行版实验支持。
4. Git 能力优先级：推荐提交/分支与标签/stash 优先于远程同步，再到 merge/rebase；根据实际用户工作流调整。
5. 插件：推荐至少等跨平台与 Git 操作模块稳定后，再决定是否开放外部插件 API。

## 7. 执行 Agent 可复制提示词

```text
你负责在 GitDock 仓库执行 docs/08-GitDock产品路线-国际化与多平台.md。先阅读根目录 AGENTS.md、README.md、docs/05-交接文档.md、docs/03-技术架构.md、docs/06-GitDock后续需求与执行计划.md、本文件及相关 ADR。用户提出的路线以本文件的已确认需求为准；“风险与产品裁决点”中尚未确认的内容先整理成简短选择题和推荐理由，继续可独立工作，不得擅自扩大正式支持范围。

按 G0 → G1/G2 → G3 → G4 → G5 推进；G6 按用户确认的单项 Git 能力另起 ADR 和验收标准。每阶段先同步需求/架构/任务文档，再实现；每个独立任务渐进提交，中文提交说明。不 push、不发版、不改版本号，除非用户明确授权。测试和验证由执行 agent 负责，记录实际命令、平台和结果。

产品原则：GitDock 长期覆盖日常 Git 工作流，默认 UI 保持简洁；高频操作做原生界面，高级低频操作渐进加入并收在上下文/高级区域，暂未支持项由当前仓库的内置 LazyGit/Shell 承接。通用第三方插件 API 暂缓，不向前端开放任意命令执行或任意路径访问。

国际化：简体中文与英文；默认跟随系统语言，用户可以覆盖，切换即时生效并持久化。所有 UI 文案集中到类型安全资源，Git 原始内容保持原样。新增文案扫描和英文布局验收纳入门禁。

多平台：保留 Windows，新增 macOS/Linux。先在 macOS 和 Ubuntu LTS 建 CI Spike 并实测终端、Git、文件对话框、URL 打开、文件监听、中文路径、配置迁移与 release 包；之后建立 src-tauri 内部平台适配层。Linux 首发格式和 macOS CPU/最低版本未由用户确认前，只做调查与可逆准备，不发布未经确认的支持承诺。

Git 写操作继续只通过 GitWriteModule 白名单、Gate、互斥和参数数组执行；扩展每项操作前补齐前置状态、确认、错误/恢复、刷新与 Given/When/Then。不得自动 stash/reset/clean/丢弃。所有异步 UI 数据遵守 repository generation 和 RefreshCoordinator。

完成阶段时，对照该阶段验收标准逐项汇报：文件与架构变化、测试/原生平台验证命令和结果、依赖/许可证、安装包格式与体积、未覆盖环境、风险、下一阶段建议。禁止把交叉编译等同于实机支持，禁止声称未实测结果。
```

## 8. 参考资料

- Tauri 2 平台前置条件：https://v2.tauri.app/start/prerequisites/
- Tauri 2 分发格式：https://v2.tauri.app/distribute/
- Tauri 2 macOS 签名与公证：https://v2.tauri.app/es/distribute/sign/macos/
- Tauri 2 插件权限模型：https://v2.tauri.app/develop/plugins/
