# G5：Linux 包格式比选（AppImage vs deb）

> 状态：**已裁决（2026-11-04，用户选 A：deb 主格式 + AppImage 实验级保留）**；本地落地同日完成（release.yml 指引措辞 + tauri.conf.json bundle.linux），实机验证部分见 §4。
> 基线已裁决（2026-11-03）：Ubuntu 22.04 LTS x86_64（glibc 2.35），其他发行版实验支持。

## 1. 背景与输入

- CI 双格式产出已就绪：release.yml build matrix 在 `ubuntu-22.04` 上同时产出 AppImage 与 deb（`--bundles appimage,deb`），仅作 G5 比选供样，不构成支持承诺。
- Release 说明已内置平台指引（G4 / PR #6）：AppImage 需要 `sudo apt install libfuse2`（Ubuntu 22.04+）；deb 安装时自动解析 WebKitGTK 依赖。
- 关键技术事实（docs/09 B-2 已调查确认）：**Tauri 打 deb 时自动生成依赖声明**（WebKitGTK/GTK 等，apt 安装即自动补齐）；**AppImage 不打包 WebKitGTK**，运行时依赖目标机系统库。
- docs/09 §10 已把「AppImage 的 WebKitGTK 跨发行版兼容」列为 G5 主要风险议题。
- 自更新机制现状（update.rs，已核实）：只做版本检查并打开 Release 页面，**下载安装由用户在浏览器手动完成**；项目未启用 Tauri 自动更新器（tauri.conf.json 无 updater 配置）。
- `tauri.conf.json` bundle 段无 Linux 定制（category 等走 Tauri 默认），定案后如需补充属一行级可逆改动。

## 2. 逐维比选

| 维度 | deb | AppImage |
|---|---|---|
| 全新安装 | `sudo apt install ./gitdock_x.y.z_amd64.deb`，WebKitGTK 等依赖自动装齐，装完即用 | 下载 + `chmod +x` + 直接运行；但 Ubuntu 22.04+ 需先装 libfuse2，且系统需已有 WebKitGTK 4.1 |
| 系统依赖 | 自动声明、自动解析，「系统依赖说明清楚」完成标准天然满足 | 依赖目标机 WebKitGTK，跨发行版版本差异可能导致起不来或渲染异常（docs/09 记录的阻塞点） |
| 桌面集成 | .desktop 菜单项与图标自动生成 | 不自动；无菜单项/图标，需手动创建或依赖第三方集成工具 |
| 升级 | 同名新 deb 重装即升级；后续可再加 apt 仓库走 `apt upgrade` | 下载新文件手动替换；无包管理器记录 |
| 卸载 | `sudo apt remove gitdock`，系统内记录清晰 | 删除文件即可；两者均会残留用户配置目录（对等） |
| 免 root / 便携 | 需 sudo，写系统目录 | 无需 root，单文件可放任意位置（U 盘/只读环境友好） |
| 发行版覆盖 | deb 系（Ubuntu/Debian/Mint…）；Debian 12 含 webkit2gtk-4.1，可解析依赖 | 理论跨发行版；实际受 WebKitGTK 系统库差异制约，风险大于收益 |
| 未来应用内自动更新 | Tauri 更新器不支持 deb；届时走系统包管理器（需自建 apt 仓库） | Tauri 更新器在 Linux 仅支持 AppImage——若未来想引入应用内自动更新，AppImage 是唯一官方路径 |
| 与当前更新设计匹配 | 对等（均为用户手动浏览器下载） | 对等 |

## 3. 推荐方案：deb 主格式 + AppImage 实验级保留

理由：

1. **G5 完成标准的达成路径**：完成标准要求「目标发行版全新安装、升级和卸载通过；系统依赖说明清楚」。deb 的依赖自动解析让 WebKitGTK 前置条件自动满足，三条路径（装/升/卸）都有包管理器语义兜底；AppImage 则把 WebKitGTK 兼容性风险留给用户。
2. **基线裁决削去了 AppImage 的核心卖点**：基线已定为 Ubuntu 22.04 单发行版，AppImage 的「跨发行版便携」价值有限；而它的核心风险（WebKitGTK 系统库差异）恰是 docs/09 记录的发行阻塞。
3. **桌面集成开箱即用**：GitDock 是菜单驱动的桌面应用，deb 自动生成菜单项与图标；AppImage 装完在应用列表里「不存在」。
4. **保留成本为零**：release.yml 双产出已就绪，AppImage 继续作为「免 root 便携 / 其他发行版实验」通道发布，Release 说明措辞按主次调整即可。

代价与说明：

- deb 需要 sudo，无法覆盖「无 root 桌面环境」——该场景由实验级 AppImage 承接。
- 放弃了未来应用内自动更新对 AppImage 的独占优势：若 G6 之后引入 Tauri 更新器，Linux 端只能覆盖 AppImage 用户，deb 用户走 apt 仓库方案（届时另立 ADR）。当前更新设计为手动浏览器下载，此代价不影响现阶段。

## 4. 定案后的 G5 剩余工作（预估，待裁决后展开）

| 工作项 | 内容 | 预估 |
|---|---|---|
| 主格式落地 | ~~Release 说明措辞按主次调整；`tauri.conf.json` 补 `bundle.linux`~~ **已落地（2026-11-04）**：release.yml 的 Linux 指引改为 deb 主格式优先、AppImage 标注实验级；`bundle.linux.category: "Development"`。README 安装说明的 WebKitGTK 依赖展示延后到实机验证后随「其他发行版支持等级」一并补——实机未验证前不在用户文档宣称安装方法 | 0.5 天 |
| 实机验证矩阵 | Ubuntu 22.04 全新安装/升级/卸载 + docs/09 §6 功能清单 Linux 部分（PTY/Shell、中文路径、inotify 文件监听、主题、剪贴板、A-4 进程组回收）。固定清单见 [Linux 安装验收](verification/Linux-安装验收.md) | 需 Ubuntu 实机或 runner 安装验证（用户资源） |
| 其他发行版支持等级 | 记录 Debian 12（deb 可用）/ 其他（AppImage 实验）等级声明；不承诺未验证发行版 | 0.5 天 |
| artifact 可复现验证 | prerelease tag 首跑 release.yml，核对产物与体积记录 | 随 tag 授权 |

## 5. 裁决记录

**2026-11-04 用户裁决：选项 A——deb 主格式 + AppImage 实验级保留。**

| 选项 | 内容 | 后果 |
|---|---|---|
| **A（已选定）** | deb 主格式 + AppImage 实验级保留 | 完成标准达成路径最稳；安装体验开箱即用；双产出维持现状 |
| B | AppImage 主格式 | 便携与免 root 优先；接受 WebKitGTK 兼容风险、libfuse2 前置与无桌面集成 |
| C | 双格式平级 | 不区分主次；文档与指引将含糊，验证矩阵需双份，不推荐 |
