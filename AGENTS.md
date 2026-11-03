# GitDock 桌面端

Tauri 2 + React 18 + Rust workspace 的 Git 桌面客户端。前端在 `src/`，Tauri 主进程在 `src-tauri/`，Git 能力在 `crates/`（git-core / git-read / git-write / graph-layout）。

## 架构边界（硬规则）

模块职责与不变量的完整定义见 [docs/03-技术架构.md](docs/03-技术架构.md)，本节只列写代码时最容易越界的约束。改动与架构文档冲突时先对齐文档再动手；架构级决策（新模块、新依赖方向、契约变更）在 `docs/adr/` 新增一篇 ADR，不只写在提交信息里。

- **依赖方向**：`git-core` 是底座（OID / DTO / 错误码 / cursor），不依赖任何内部 crate；`graph-layout`、`git-read`、`git-write`、`refresh` 只向下依赖 `git-core`；只有 `src-tauri` 装配各 crate。新增依赖沿此方向，完成时能说清"新代码依赖谁、谁依赖它"。
- **graph-layout 保持纯函数**：输入 `GraphPage`、输出可渲染增量，不访问文件系统、不执行 Git、不读时钟。
- **Git 知识各归一处**：对象格式 / 遍历 / diff 只在 `git-read`；写操作只在 `git-write` 的白名单 + Gate 内扩展；前端 feature 和 `graph-layout` 中不出现 Git 命令、`.git` 路径、对象解析。
- **跨进程只走 Tauri command seam**：新能力 = 受限 DTO + command，返回 `Result<Dto, UserVisibleError>`；不给前端开通用命令执行或任意路径通道。
- **契约集中在 git-core**：改 DTO、错误码、cursor 属于全链路变更，同步更新 Rust 端、前端 `src/shared/types.ts` 与架构文档。
- **UI 数据只接受最新 generation**：刷新经 RefreshCoordinator 标脏后重读，不绕过 generation 直接改 UI 数据。
- **主题只用 CSS 语义令牌**：组件内不写死浅/深两套颜色。

## 文件行数（硬规则）

按物理行（`wc -l`）计算，对所有源码与测试文件生效：

- 单文件上限 **600 行**，新文件按 **400 行以内**规划。
- 动手前先估算规模：预计超 400 行的实现，先设计拆分再写，而不是写完后补救。
- 完成判据：每次改动结束后自查所有触及文件的行数。超过 600 行必须当场拆分，拆分完成才算任务完成；不接受"先提交、后续再优化"。
- 修改已超过 600 行的存量文件（如 `crates/git-write/src/lib.rs`、`src/App.tsx`、`src-tauri/src/app/gitconfig.rs`）时，行数只减不增：新逻辑放进新模块，或本次顺带拆出一块。

### 拆分方向

- **React**：一个文件一个主组件；子组件拆到同目录独立文件，状态逻辑提炼为 hooks（`.ts`），纯函数进工具模块，类型归 `src/shared/types.ts`。
- **Rust**：按职责拆 `mod`，一个文件一个关注点；测试按场景分文件，不堆在单一 integration 测试里。
- **CSS**：按视图/区块分文件，沿用 `src/styles/` 现有划分。

拆分保持行为不变：纯移动代码，不顺手重构逻辑。

## 验证

- 前端改动跑 `npm run build`（含 `tsc --noEmit`），整体检查跑 `npm run check`。
- 涉及窗口、终端、CSP 的改动，必须构建 release 并直接运行 GUI exe 验证；dev 模式与测试会掩盖 Windows 终端接管和 CSP 差异。

## 边界

- 提交、打 tag、推送都只在用户明确要求时执行；版本号只能由 `npm run bump` 统一修改。
- `poc/` 是试验目录，其中的代码不进主流程。
