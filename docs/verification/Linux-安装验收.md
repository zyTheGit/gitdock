# Linux 安装验收清单（Ubuntu 22.04 x86_64）

- 状态：待实机执行；本文固定验收口径，避免把 CI 构建通过误记为已支持
- 基线：Ubuntu 22.04 LTS x86_64（glibc 2.35）；deb 为主格式，AppImage 为实验级
- 关联：docs/10（包格式裁决）、docs/09 §6（跨平台功能清单）

## 1. 状态词

验收结论只使用以下五级词：

1. 代码可编译
2. CI 通过（三平台 `npm run check` 绿）
3. 原生环境安装通过（目标机安装/启动成功）
4. 实机验收通过（下列功能清单全通过）
5. 正式发布（Release 声明与包仓库/下载页就绪）

当前实际等级：**CI 通过**。安装与 GUI 功能未在目标实机执行，不得表述为「已支持 Linux」或「正式发布」。

## 2. 非侵入式包检查（已执行）

在 Windows 侧下载 `v0.2.0-rc.1` artifact，使用 WSL 的 `dpkg-deb` 读取（不安装）：

| 检查项 | 结果 |
|---|---|
| 包名 / 版本 / 架构 | `git-dock` / `0.2.0-rc.1` / `amd64` |
| 依赖声明 | `libwebkit2gtk-4.1-0, libgtk-3-0` |
| 桌面入口 | `usr/share/applications/GitDock.desktop`，`Exec=gitdock-app`，`Type=Application` |
| 主程序 | `usr/bin/gitdock-app` |
| 图标 | 32/128/256(`@2`) PNG |
| 当前 WSL 环境 | 缺 `libwebkit2gtk-4.1.so.0`、`libsoup-3.0.so.0`、`libjavascriptcoregtk-4.1.so.0`；无 sudo，未安装 |

结论：包结构与桌面集成文件符合 deb 预期；依赖必须由 apt 自动解析，不能只解包运行。

## 3. 安装 / 升级 / 卸载

在全新 Ubuntu 22.04 虚拟机或 runner 上执行并记录命令输出：

```bash
sudo apt install ./GitDock_0.2.0-rc.1_amd64.deb
dpkg -s git-dock
ls -l /usr/bin/gitdock-app /usr/share/applications/GitDock.desktop
desktop-file-validate /usr/share/applications/GitDock.desktop
gitdock-app
sudo apt install ./GitDock_<new>_amd64.deb
sudo apt remove git-dock
```

通过标准：

- `apt install` 无未满足依赖；`dpkg -s` 记录版本正确。
- 桌面菜单出现 GitDock，图标正常；点击可启动。
- 升级后版本变化，配置与最近仓库保留。
- 卸载后主程序/桌面项移除；用户配置目录残留可接受并在发布说明中写明。

## 4. AppImage（实验级）

```bash
sudo apt install libfuse2
chmod +x GitDock_0.2.0-rc.1_amd64.AppImage
./GitDock_0.2.0-rc.1_amd64.AppImage
```

通过标准：系统已装 WebKitGTK 4.1 时可启动；无桌面集成/菜单项按实验级记录。不承诺跨发行版兼容。

## 5. 功能清单（逐项打勾）

| # | 场景 | 通过标准 |
|---|---|---|
| 1 | Git 读取 | 打开仓库、图谱、提交详情、diff 正常 |
| 2 | Git 写入 | stage/unstage、commit、stash、分支/标签操作成功 |
| 3 | 远程 | fetch/pull --ff-only/push 对本地 bare remote 成功；凭据失败有提示 |
| 4 | PTY / Shell | 内置终端可启动 LazyGit 与 Shell；中文输入输出正常；退出无残留进程 |
| 5 | 中文路径 | 仓库路径含中文/空格时可打开、刷新、写操作 |
| 6 | 文件监听 | 终端内提交/切换后图谱与工作区自动刷新；inotify 生效 |
| 7 | 桌面集成 | 文件选择器、打开 URL、主题、剪贴板、图标正常 |
| 8 | A-4 进程组 | 关闭应用或切换仓库后无孤儿 shell/子进程 |
| 9 | 升级/卸载 | 见 §3 |

## 6. 记录模板

```text
日期：
执行人：
Ubuntu 版本 / 桌面环境 / glibc：
deb 版本与 sha256：
安装结果：
启动结果：
功能清单失败项与日志：
结论（五级词）：
```