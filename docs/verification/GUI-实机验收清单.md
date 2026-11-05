# GUI 实机验收清单（G6 批次 1–5 + 命令日志 + 终端）

- 适用版本：`v0.2.0`（main 基线 `d4d814f`）
- 更新日期：2026-11-05
- 用途：把「代码已实现、尚未实机验收」的能力收敛成可逐项勾选的用户任务清单
- 状态词口径：本清单全部通过后，对应能力才可从「CI 通过」提升为「实机验收通过」；macOS 仍为「未签名实验版」，不计入正式支持

## 0. 环境准备

- [ ] 使用 **release 构建**验证（`npm run tauri build`，产物 `target/release/gitdock-app.exe`）；dev 模式会掩盖终端接管与 CSP 差异
- [ ] 准备一个可随意改动的测试仓库（建议复制仓库后新建测试分支，勿在主工作仓库执行破坏性用例）
- [ ] 准备一个本地 bare 远端（`git init --bare`）用于 fetch/pull/push
- [ ] 记录验收环境：OS 版本、Git 版本、屏幕分辨率/缩放、语言（中/英）

## 1. 批次 1：提交创建与 amend（ADR-0007）

- [ ] 1.1 新仓库（unborn HEAD）：暂存文件 + 输入多行消息 → 提交成功；`git log --oneline -1` 与 `git show HEAD` 独立核对消息与文件
- [ ] 1.2 空暂存区点提交 → 拒绝并展示 `gate_nothing_to_commit`
- [ ] 1.3 空消息/仅空白 → 拒绝并展示 `gate_empty_message`
- [ ] 1.4 amend 仅改消息：确认框展示被替换的 HEAD（短 oid + 主题）与 reflog 恢复说明；执行后树内容不变、committer 更新
- [ ] 1.5 amend 带暂存变更：`git show HEAD` 核对内容与消息
- [ ] 1.6 pre-commit hook 返回 exit 1 + stderr → 提交失败、HEAD 未变、stderr 可见
- [ ] 1.7 提交/amend 后临时消息文件不残留（检查系统临时目录）

## 2. 批次 2：分支与标签（ADR-0008）

- [ ] 2.1 从当前 HEAD 新建分支：`refs/heads/<name>` 指向原 HEAD，当前分支不变
- [ ] 2.2 从指定 commit 新建分支：新 ref 指向该 commit
- [ ] 2.3 删除已合并分支成功；删除当前分支/未合并分支被拒绝且 ref 保留
- [ ] 2.4 重命名分支：旧 ref 消失、新 ref 指向原提交；重命名当前分支后 HEAD 跟随
- [ ] 2.5 创建轻量标签（`cat-file -t` = commit）与附注标签（= tag），多行消息保真
- [ ] 2.6 删除本地标签后 `show-ref` 不存在；非法/重复名称被 Gate 拒绝
- [ ] 2.7 标签删除入口统一为右键菜单：侧栏标签行右键 →「删除标签」→ 确认框；侧栏不再出现「删除」链接
- [ ] 2.8 「删除本地和远程分支」（ADR-0022）：菜单项仅在存在远程跟踪引用时可用；确认后本地与远程分支均消失；远程失败时提示「本地已删除，远程删除失败」并保留对话框；未合并分支在第一段被 Git 拒绝、远程不删除

## 3. 批次 3：stash（ADR-0009）

- [ ] 3.1 有 tracked 改动时 save：工作区恢复干净，列表新增 1 条，消息与时间正确
- [ ] 3.2 仅未跟踪文件、未勾选 include_untracked → 拒绝并提示勾选；勾选后 save 成功
- [ ] 3.3 工作区无改动 → `gate_stash_nothing`
- [ ] 3.4 apply 后条目保留，`git diff` 核对内容恢复
- [ ] 3.5 pop 成功后条目移除；pop 冲突时条目保留、冲突文件可见并可进入冲突流
- [ ] 3.6 drop 移除指定条目、其余索引前移；越界 selector 被拒绝；确认框展示 oid 与恢复说明
- [ ] 3.7 `stash_list` 与 `git stash list` 的条目数、顺序、消息一致
- [ ] 3.8 分支切换 dirty 确认框的「先 stash 当前改动」入口可用，保存后可继续切换

## 4. 批次 4：fetch / pull / push（ADR-0010）

- [ ] 4.1 Fetch 后 `refs/remotes/origin/main` 与 bare remote 一致
- [ ] 4.2 本地落后远端：Pull 后 HEAD 快进、工作区文件更新
- [ ] 4.3 本地 ahead：Push 后 bare remote 的 main 指向本地提交
- [ ] 4.4 远端 ahead 且本地分叉：Push 被拒绝、远端不变、展示 `outcomePushRejected` 与 stderr
- [ ] 4.5 脏工作区：Pull Gate 拒绝 `gate_remote_dirty_pull`，不执行命令
- [ ] 4.6 无 remote / 无 upstream / detached HEAD：Fetch/Pull/Push 分别被 Gate 拒绝
- [ ] 4.7 认证失败：分类为 `outcomeRemoteAuthFailed`，提示终端授权或凭据配置；应用日志不含凭据

## 5. 批次 5：merge / rebase / 完整 pull（ADR-0011）

- [ ] 5.1 非快进 merge 生成 2 父合并提交；冲突时 `Conflicted` 且 `MERGE_HEAD` 存在
- [ ] 5.2 rebase 后当前分支提交重放到目标之上，`HEAD~1` 为目标分支 HEAD
- [ ] 5.3 merge/rebase Gate 拒绝自身、脏工作区、detached/unborn、目标不存在
- [ ] 5.4 pull ff-only 非快进继续提示；pull merge 成功与冲突两条路径符合预期
- [ ] 5.5 冲突后继续/中止：标记消失才算成功；不自动 skip/abort
- [ ] 5.6 批量 cherry-pick / revert：Shift+点击选中 ≥2 个提交 → 右键「批量 Cherry-pick / Revert」→ 确认框按选择顺序展示 → 执行成功；中途冲突后可在横幅继续或中止，标记消失才算完成

## 6. 冲突分组真实仓库实测

- [ ] 6.1 真实 `MERGE_HEAD` 冲突仓库：暂存区冲突分组渲染正确
- [ ] 6.2 解决冲突后刷新，分组消失且可继续 merge
- [ ] 6.3 rebase 冲突（`rebase-merge`）：同上
- [ ] 6.4 继续/中止横幅与 Gate 状态一致，无残留标记

## 7. 命令日志弹窗

- [ ] 7.1 状态栏入口可打开；列表按最新在前
- [ ] 7.2 搜索匹配命令/目录/stderr；清除按钮可用
- [ ] 7.3「只看失败」过滤正确；顶部统计随筛选更新
- [ ] 7.4 行展开显示 cwd、启动时间（精确到秒）、stderr；空 cwd 显示 `—`
- [ ] 7.5 工作目录不出现 `\\?\` 前缀（Windows 写操作记录）
- [ ] 7.6 复制命令、复制路径成功反馈；清空需二次确认，确认态为危险色
- [ ] 7.7 刷新中图标旋转且按钮禁用，完成后短暂显示「已刷新」
- [ ] 7.8 窄窗口下 header/filter 整组换行，按钮文案不拆行

## 8. 终端与 Shell

- [ ] 8.1 设置 `shell_profile=git_bash` 后，下次启动终端确为 Git Bash（`--login -i`），无 PATH 回退
- [ ] 8.2 LazyGit 模式仍可启动，全屏键在 macOS 下为 ⌘
- [ ] 8.3 终端中文输入法组合输入不丢字、候选窗跟随光标（真机输入法）
- [ ] 8.4 关闭应用/切换仓库后无孤儿 shell 进程（Unix 实机）

## 9. 跨批次回归

- [ ] 9.1 每个写操作后图谱、暂存区、分支/标签、stash 列表刷新正确，无旧 generation 覆盖新数据
- [ ] 9.2 中英文切换后上述界面文案完整、无硬编码中文、按钮不拆行
- [ ] 9.3 浅色/深色主题下新增按钮、危险色、徽标对比度正常
- [ ] 9.4 `Esc` 只关闭最上层弹框；忙碌态不误关
- [ ] 9.5 设置入口（ADR-0012 修订后）：Windows/Linux 无原生菜单栏（标题栏下无独立菜单行，深色模式无白色横条）；顶栏「设置」按钮在刷新右侧，`Ctrl+,` / `Cmd+,` 均可打开设置；macOS 保留应用菜单（设置/关于/退出），「关于」直达设置弹窗「关于」分区；版本/检查更新/反馈在关于分区内完成；顶栏无终端按钮（终端经底部面板/状态栏/快捷键打开）；语言切换后 macOS 菜单文案即时更新

## 10. 结果汇总

| 批次 | 通过 | 失败 | 证据/备注 |
|---|---|---|---|
| 1 提交/amend | | | |
| 2 分支/标签 | | | |
| 3 stash | | | |
| 4 远程 | | | |
| 5 merge/rebase | | | |
| 冲突分组 | | | |
| 命令日志 | | | |
| 终端/Shell | | | |
| 回归 | | | |

> 未通过项请记录：操作步骤、预期、实际、截图或 stderr。涉及数据安全的项（amend/rebase/drop/push）失败时先停止后续用例。