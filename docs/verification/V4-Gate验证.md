# V4 准入验证：CLI Gate、冲突、hook 拒绝、空 pick、worktree 占用与恢复

> 对应任务：`04-任务拆分.md` 中 V4。验证目标不是证明现有实现正确（阶段 0 尚无实现），而是为 W1/W2/W3 固定**可实测的行为契约**。
> 结论口径：所有写操作唯一实现为系统 Git CLI（参数数组、不经 shell）；绝不自动执行 `--abort` / `--quit`；状态路径必须经 `git rev-parse --git-path` 取得。

## 0. 结论摘要

| 判断项 | 结果 |
|---|---|
| 系统 Git 存在且可用 | 是，`git version 2.53.0.windows.2` |
| 触发 `02-选型终审.md` 否决条件（Git 缺失 / 低于最低版本） | **未触发** |
| 写前 Gate 是否可以用「仅 `status --porcelain=v2`」实现 | **不可以**：空 pick、prepare-commit-msg 拒绝两种中断在 porcelain 中**无任何异常行**，只能靠 `--git-path` 标记文件识别 |
| `git cherry-pick <oid>` 是否触发 pre-commit / commit-msg hook | **不触发（被绕过）**；只触发 prepare-commit-msg 与 post-commit |
| `git cherry-pick --continue` 是否触发 hook | **触发** pre-commit 与 commit-msg（与一次性 pick 不一致） |
| worktree 占用能否拦截 | 能，`switch` 返回 128 且 stderr 含占用路径；Gate 可提前用 `worktree list --porcelain` 预判 |
| 空 pick 退出码 | **1**（不是 128），`CHERRY_PICK_HEAD` 残留，索引与工作区干净 |
| 冲突可恢复性 | 用户显式 `--abort` 可完全恢复（rc=0），应用侧不得自动执行 |

## 1. 环境与方法

- 平台：Windows（win32），bash（Git for Windows 自带 sh）；Git `2.53.0.windows.2`；cargo 1.99.1。
- 夹具来源：`cargo run -q -p fixture-gen -- target/v4`（退出码 0）。`target/v4` 原始夹具**只读**。
- 实验方式：将夹具 `cp -r` 到 `%TEMP%/v4-gate-<pid>`，全部写操作只发生在副本中。
- worktree 副本的特殊处理：`worktree-linked/.git` 与 `worktree-main/.git/worktrees/worktree-linked/gitdir` 在复制后仍指向 `target/v4` 原始路径。为避免实验写入原始夹具，已把这两处指针改写为临时副本的绝对路径（Windows 形式 `C:/...`，MSYS 形式 `/c/...` 不被 Git 接受，会得到 `fatal: not a git repository`）。改写后 `git -C <copy> worktree list` 只显示临时路径，且实验结束后原始夹具 `worktree list` 与 `status` 未变化。
- 确定性环境：设置 `GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=<空文件>`，避免本机全局配置（`advice.*`、`core.hooksPath`、`autocrlf`）污染结论；副本内单独设置 `user.name` / `user.email` 以便产生提交。
- 每条命令均以 `git -C <repo> <args>` 形式执行（等价于参数数组、不经 shell），并分别重定向 stdout / stderr 记录。

## 2. Gate 探测（矩阵 1）

### 2.1 探测命令与返回值形态

| 仓库 | `--is-bare-repository` | `--git-dir` | `--git-path CHERRY_PICK_HEAD` | `--show-object-format` |
|---|---|---|---|---|
| linear（普通） | `false` | `.git`（相对） | `.git/CHERRY_PICK_HEAD`（相对） | `sha1` |
| dirty（普通） | `false` | `.git` | `.git/CHERRY_PICK_HEAD` | `sha1` |
| bare | `true` | `.` | `CHERRY_PICK_HEAD`（无 `.git/` 前缀） | `sha1` |
| worktree-main | `false` | `.git` | `.git/CHERRY_PICK_HEAD` | `sha1` |
| worktree-linked | `false` | `C:/.../worktree-main/.git/worktrees/worktree-linked`（绝对） | 该绝对目录下 `.../CHERRY_PICK_HEAD`（绝对） | `sha1` |
| sha256 副本 | `false` | `.git` | `.git/CHERRY_PICK_HEAD` | `sha256` |

补充实测：

- `git rev-parse --git-path <任意不存在名>` 仍返回路径且 **rc=0**（如 `.git/nothing-here`）。因此「返回值非空」不代表中断存在，必须对磁盘做存在性判断。
- `--git-path` 的**相对结果相对于 git 进程的 cwd，而不是相对于仓库根**。在 `linear/sub/dir` 下执行得到 `../../.git/CHERRY_PICK_HEAD`。linked worktree 下即使从子目录执行也返回绝对路径。
- `--git-dir` 在 bare 下是 `.`，`--git-common-dir` 在 linked worktree 下指向主仓库 `.git`。
- bare 仓库执行 `status --porcelain=v2 --branch` 与 `rev-parse --show-toplevel` 均 **rc=128**：`fatal: this operation must be run in a work tree`。Gate 必须先判 `--is-bare-repository`，否则写前探测本身就会报错。

### 2.2 porcelain v2 三种形态

```text
# 干净（linear / worktree-main）
# branch.oid 842cf94a3231151a4a8f95aaf97d60a164f0c04d
# branch.head main

# 脏（dirty）
# branch.oid 9b568233205e5b2dc569190b1242e47f1a2b42e9
# branch.head main
1 .M N... 100644 100644 100644 83126302... 83126302... tracked.txt
? untracked.txt

# 冲突（cherry-pick 冲突）
# branch.oid 012835769ef9db8490231171cb08d94c444b2184
# branch.head main
u UU N... 100644 100644 100644 100644 df967b96... ba2906d0... a7453f07... conflict.txt
```

- `u` 行第 2 字段是 XY 冲突码，实测出现 `UU`（双改）与 `AA`（add/add，见 8.2）；第 3 字段为子模块状态 `N...`。
- `# branch.oid` 与 `# branch.head` 反映**当前 HEAD**，不是被 pick 的提交；rebase 中断时 `branch.head` 变成 `(detached)`。
- `# branch.upstream` / `# branch.ab` 仅在存在上游时出现（本夹具未配置，故缺失）——解析器不得把它们当作必有字段。
- `-z` 输出与普通输出内容一致（`u` 行按 NUL 分隔），可作为路径含空格/非 ASCII 时的稳健通道。

### 2.3 相对路径陷阱（W1 必须规避）

实测（cwd = 项目根，仓库 = 临时副本）：

```text
git -C <repo> rev-parse --git-path CHERRY_PICK_HEAD   ->  .git/CHERRY_PICK_HEAD
test -e .git/CHERRY_PICK_HEAD                          ->  NO   （假阴性）
test -e <repo>/.git/CHERRY_PICK_HEAD                   ->  YES
```

本次验证中该陷阱真实导致过一次误判（把「prepare-commit-msg 拒绝」错读为「无中断」）。契约：**相对结果必须与 `--show-toplevel`（bare 场景与 `--absolute-git-dir`）拼接**，或始终以 `--show-toplevel` 作为子进程 cwd。

## 3. 状态机结果表（核心交付物）

`<oid>` 表示参数数组中的提交 ID；`CPH` = `CHERRY_PICK_HEAD`，`RVH` = `REVERT_HEAD`。所有命令均在副本执行，`--abort` / `--quit` / `--skip` 只在实验里手动执行。

| # | 场景 | 命令 | 退出码 | stdout / stderr 关键行 | 标记文件 | porcelain 特征 | 建议状态 |
|---|---|---|---|---|---|---|---|
| 1 | Gate：干净 | `status --porcelain=v2 --branch` | 0 | 仅 `# branch.oid` / `# branch.head` | 无 | 无变更行 | `Ready` |
| 2 | Gate：脏 | 同上 | 0 | `1 .M ...`、`? untracked.txt` | 无 | 1 行 `1` + 1 行 `?` | `Ready(dirty)` |
| 3 | pick 成功 | `cherry-pick <pick-source>` | **0** | stdout `[main bb008eb] commit to cherry pick` / `1 file changed` | 无（CPH、sequencer 均不存在） | 干净 | `Succeeded` → `Ready` |
| 4 | pick 冲突 | `cherry-pick feature` | **1** | stdout `CONFLICT (content): Merge conflict in conflict.txt`；stderr `error: could not apply aada3a6...` + 5 行 hint | **CPH=YES**，sequencer=no | `u UU` | `Conflicted` |
| 5 | 冲突态再 pick | `cherry-pick <oid>` | **128** | `error: Cherry-picking is not possible because you have unmerged files.` / `fatal: cherry-pick failed` | CPH 保留 | `u UU` | 拒绝（Gate 先行，不应到达此处） |
| 6 | 冲突态 switch | `switch --no-guess feature` | **128** | `fatal: cannot switch branch while cherry-picking` | CPH 保留 | `u UU` | `Blocked(interrupted)` |
| 7 | 冲突态 revert / commit | `revert HEAD` / `commit -m` | **128** | `Reverting is not possible because you have unmerged files.` / `Committing is not possible...` | 不变 | `u UU` | 拒绝 |
| 8 | revert 成功 | `revert --no-edit HEAD` | **0** | stdout `[main 61d3a8c] Revert "linear commit 6"` | 无 | 干净 | `Succeeded` |
| 9 | revert 冲突 | `revert --no-edit <oid>` | **1** | `CONFLICT (content)`；`error: could not revert aada3a6...` | **RVH=YES**，CPH=no | `u UU` | `Conflicted(revert)` |
| 10 | revert 冲突态 switch | `switch --no-guess feature` | **128** | `fatal: cannot switch branch while reverting` | RVH 保留 | `u UU` | `Blocked(interrupted)` |
| 11 | 空 pick | `cherry-pick source` | **1**（不是 128） | stderr `The previous cherry-pick is now empty, possibly due to conflict resolution.` / `git commit --allow-empty` / `Please use 'git cherry-pick --skip'`；stdout `nothing to commit, working tree clean` | **CPH=YES**，索引干净，sequencer=no | **无异常行**（与干净态完全相同） | `NeedsUserDecision(empty)` |
| 12 | 空 pick + `--allow-empty` | `cherry-pick --allow-empty source` | **1** | 同上（参数无效） | CPH=YES | 无异常行 | `NeedsUserDecision(empty)` |
| 13 | 空 pick + `--empty=drop` | `cherry-pick --empty=drop source` | **0** | stderr `dropping 4e7c5bf... patch contents already upstream` | 无 | 干净，HEAD 不变 | `Skipped`（静默丢弃，不建议默认） |
| 14 | 空 pick 后 switch | `switch --no-guess main` | **128** | `fatal: cannot switch branch while cherry-picking` | CPH 保留 | 无异常行 | `Blocked(interrupted)` |
| 15 | hook：pre-commit 拒绝普通提交 | `commit -m` | **1** | stderr `fixture hook rejects commit` | 无 | 暂存区保留 | `HookRejected(commit)` |
| 16 | hook：pre-commit 对一次性 pick | `cherry-pick <oid>` | **0** | stdout `[main 5b9d28b] hook source`；**hook 未输出** | 无 | 干净，提交已生成 | **hook 被绕过** |
| 17 | hook：commit-msg 对一次性 pick | `cherry-pick <oid>` | **0** | 无 hook 输出 | 无 | 提交已生成 | **hook 被绕过** |
| 18 | hook：prepare-commit-msg 对 pick | `cherry-pick <oid>` | **128** | stderr `prepare-commit-msg hook rejects` / `error: 'prepare-commit-msg' hook failed` / `fatal: cherry-pick failed` | **CPH=YES**，`1 A.` 暂存 | 1 行 `A.` | `HookRejected` |
| 19 | hook：post-commit 对 pick | `cherry-pick <oid>` | **0** | stderr `post-commit fired` | 无 | 提交已生成 | hook 正常触发 |
| 20 | hook：`--continue` 遇 pre-commit | `cherry-pick --continue` | **1** | stderr `pre-commit rejects` | CPH 保留，`1 M.` | 已解决但未提交 | `HookRejected(in-progress)` |
| 21 | hook：`--continue` 遇 commit-msg | `cherry-pick --continue` | **1** | stderr `commit-msg rejects` | CPH 保留 | 同上 | `HookRejected(in-progress)` |
| 22 | 两步法：`--no-commit` + commit | `cherry-pick --no-commit <oid>` → `commit -C <oid>` | 0 → **1** | stderr `fixture hook rejects commit`；第一步 rc=0 无输出 | 第二步后 **无 CPH**，残留 `MERGE_MSG`、`AUTO_MERGE` | `1 A.` 暂存 | `HookRejected`（无标记，需自持日志） |
| 23 | `--no-commit` 遇冲突 | `cherry-pick --no-commit feature` | **1** | `CONFLICT (content)`；`hint: ... mark the corrected paths`（**无** `--continue` 提示） | **CPH=no**（仅残留 `MERGE_MSG`） | `u UU` | `Conflicted(no-sequencer)` |
| 24 | worktree 占用 | `switch --no-guess wt-branch` | **128** | `fatal: 'wt-branch' is already used by worktree at 'C:/.../worktree-linked'` | 无 | 不变 | `Blocked(worktree)` |
| 25 | worktree 占用 + `-f` | `switch --no-guess -f wt-branch` | **128** | 同上 | 无 | 不变 | `Blocked(worktree)` |
| 26 | 不存在的本地分支 | `switch --no-guess topic` | **128** | `fatal: invalid reference: topic` | 无 | 不变 | `Blocked(no-such-branch)` |
| 27 | dirty 且不重叠：switch | `switch --no-guess otherbr` | **0** | stderr `Switched to branch 'otherbr'`，stdout `M tracked.txt` | 无 | `.M` 被带走 | `Succeeded(dirty-carried)` |
| 28 | dirty 且重叠：switch | `switch --no-guess conflictbr` | **1** | `error: Your local changes to the following files would be overwritten by checkout:` / `tracked.txt` / `Aborting` | 无 | `.M` 保留，HEAD 不变 | `Blocked(dirty)` |
| 29 | 未跟踪文件将被覆盖：switch | `switch --no-guess ubr` | **1** | `error: The following untracked working tree files would be overwritten by checkout:` | 无 | `??` 保留 | `Blocked(dirty)` |
| 30 | dirty 且重叠：pick / revert | `cherry-pick <oid>` / `revert HEAD` | **128** | `error: Your local changes ... would be overwritten by merge:` / `Aborting` / `fatal: cherry-pick failed` | **无 CPH / RVH** | `.M` 保留 | `Blocked(dirty)`（干净失败，无残留） |
| 31 | dirty 且不重叠：pick | `cherry-pick <oid>` | **1** | `CONFLICT (add/add)`；`error: could not apply ...` | CPH=YES | `1 .M` + `u AA` 并存 | `Conflicted(dirty-carried)` |
| 32 | rebase 中断（Gate 需识别） | `rebase feature` | **1** | `CONFLICT (content)`；`Could not apply 0128357...` | `rebase-merge` 目录=YES，`REBASE_HEAD`=YES | `# branch.head (detached)` + `u UU` | `Interrupted(rebase)`（只读） |
| 33 | rebase 中断态写操作 | `cherry-pick` / `switch` | **128** | `Cherry-picking is not possible because you have unmerged files.` / `fatal: cannot switch branch while rebasing` | 不变 | 同上 | 拒绝 |

### 3.1 标记文件清单（实测存在性）

| 状态 | CPH | RVH | MERGE_HEAD | rebase-merge | sequencer | `MERGE_MSG` | `AUTO_MERGE` |
|---|---|---|---|---|---|---|---|
| 干净 / pick 成功 | no | no | no | no | no | no | **YES（残留 ref，不可当标记）** |
| revert 成功 | no | no | no | no | no | no | YES（残留） |
| pick 冲突（单提交） | YES | no | no | no | no | YES | YES |
| revert 冲突 | no | YES | no | no | no | YES | YES |
| 空 pick | **YES** | no | no | no | no | YES | YES |
| prepare-commit-msg 拒绝 | YES | no | no | no | no | YES | YES |
| `--no-commit` 冲突 | **no** | no | no | no | no | YES | YES |
| 多提交范围 pick 冲突 | YES | no | no | no | **YES**（`abort-safety`/`head`/`todo`） | YES | YES |
| rebase 冲突 | no | no | no | **YES（目录）** | no | YES | YES |

结论：`AUTO_MERGE` 在**成功**的 pick/revert 后仍然存在，绝不能作为中断标记；`MERGE_MSG` 在中断态全部存在但语义弱，仅作诊断；主标记必须是 `CHERRY_PICK_HEAD` / `REVERT_HEAD` / `MERGE_HEAD` / `rebase-merge` / `rebase-apply`，辅以 porcelain 的 `u` 行。

## 4. 分项实测记录

### 4.1 cherry-pick 成功（矩阵 2）

```text
HEAD_BEFORE = 012835769ef9db8490231171cb08d94c444b2184
git cherry-pick pick-source -> rc=0
stdout: [main bb008eb] commit to cherry pick
        Author: Fixture <fixture@example.com>
        1 file changed, 1 insertion(+)
        create mode 100644 picked.txt
stderr: (空)
HEAD_AFTER  = bb008eb9ba6dd8ae5de0fc8131d6383870a5d61c
```

`CHERRY_PICK_HEAD`、`.git/sequencer` 均不存在；`git diff --name-only` 为空。摘要行输出在 **stdout**，`stderr` 为空——不能靠 stderr 判成功。

### 4.2 cherry-pick 冲突与二次写操作（矩阵 3）

```text
git cherry-pick feature -> rc=1
stdout: Auto-merging conflict.txt
        CONFLICT (content): Merge conflict in conflict.txt
stderr: error: could not apply aada3a6... feature changes same line
        hint: ... "git add/rm <pathspec>", then run "git cherry-pick --continue".
        hint: You can instead skip this commit with "git cherry-pick --skip".
        hint: To abort ... run "git cherry-pick --abort".
CHERRY_PICK_HEAD = aada3a6b583bdca5ea34d1a7dfa321a5dbe1c506   （内容就是被 pick 的 oid）
git diff --name-only --diff-filter=U -> conflict.txt
git ls-files -u -> 3 条 stage 1/2/3 记录
status v2 -> u UU N... 100644 100644 100644 100644 <1> <2> <3> conflict.txt
```

冲突态下再次写操作全部被 Git 自身拒绝（表 3 第 5–7 行，rc=128），因此 Gate 的主要价值是**在调用前给出可读原因**，而不是代替 Git 报错。恢复：

```text
git cherry-pick --abort -> rc=0（stdout/stderr 均空）
CPH 消失，HEAD 回到 0128357，status 干净，unmerged 为空
```

应用侧只允许把 `--abort` 作为**用户显式点击**的动作；本次实验中的 abort 仅为取证。

### 4.3 revert（矩阵 4）

- 成功：`revert --no-edit HEAD` rc=0，`[main 61d3a8c] Revert "linear commit 6"`，REVERT_HEAD 不存在。
- 冲突：rc=1，`error: could not revert aada3a6...`，REVERT_HEAD=YES，`u UU`。
- **stage 语义实测（易错点）**：`u` 行与 `ls-files -u` 的三个 oid 顺序为「stage1 / stage2 / stage3」。stage2 **始终是 HEAD（ours）**；差别在 stage1 与 stage3：
  - cherry-pick：stage1 = merge base（`df967b9` = `base`），stage3 = 被 pick 提交侧（`a7453f0` = `feature`）；
  - revert：stage1 = 被回滚提交侧（`a7453f0` = `feature`），stage3 = merge base（`df967b9` = `base`）。
  即两者 stage1/stage3 互换。若 UI 要展示「本地/传入」标签，必须按操作类型解释，不能按固定顺序。
- 冲突态 switch：rc=128 `fatal: cannot switch branch while reverting`。
- `revert --abort` rc=0，REVERT_HEAD 消失，状态干净。

### 4.4 空 pick（矩阵 5）

```text
夹具结构：empty-target 与 source 都含 tree 相同的 same.txt 内容
git cherry-pick source -> rc=1
stderr: The previous cherry-pick is now empty, possibly due to conflict resolution.
        If you wish to commit it anyway, use:
            git commit --allow-empty
        Otherwise, please use 'git cherry-pick --skip'
stdout: On branch empty-target / You are currently cherry-picking commit 4e7c5bf.
        （all conflicts fixed: run "git cherry-pick --continue"）
CHERRY_PICK_HEAD = 4e7c5bf6ef3df75de186c28f418c238cd8ac7c67
status --porcelain=v2 -> 只有两行 # 头，与干净仓库完全一致
```

补充：

- `--allow-empty` **无效**（仍 rc=1）：该参数只允许「原本就空的提交」，不解决「补丁已在上游」。
- `--empty=drop` rc=0，stderr `dropping 4e7c5bf... patch contents already upstream`，HEAD 不变——静默跳过，会隐藏用户操作结果，不建议作为默认策略。
- 手动 `cherry-pick --quit` rc=0：只清除 CPH，工作区/索引不变（本例本就干净）；`cherry-pick --skip` rc=0：清 CPH，HEAD 不变。
- **风险点**：空 pick 后若 Gate 只看 porcelain，会判定「干净、可用」，随后 `switch` 直接返回 128。这必须由标记文件识别。

### 4.5 hook 拒绝（矩阵 6，直接影响 W2）

hook 文件为 `#!/bin/sh ... exit 1`，在 Windows 上无需额外 chmod 即可执行（`-rwxr-xr-x`）。

| 入口 | pre-commit | commit-msg | prepare-commit-msg | post-commit | 实测退出码 |
|---|---|---|---|---|---|
| `git commit` | 触发 | 触发 | 触发 | 触发 | 1（`fixture hook rejects commit`） |
| `git cherry-pick <oid>`（一次性） | **不触发** | **不触发** | 触发 | 触发 | 0（提交成功，hook 完全没跑） |
| `git cherry-pick --continue` | **触发** | **触发** | 触发 | — | 1，CPH 保留 |
| `git cherry-pick --no-commit` + `git commit -C <oid>` | 触发 | 触发 | 触发 | 触发 | 第一步 0，第二步 1 |

因此对 W2 的结论：

1. **一次性 `git cherry-pick` 绕过 pre-commit 与 commit-msg**（rc=0，直接生成 `5b9d28b`，`hooked.txt` 已进树）。这是 Git 上游行为，不是本项目的实现缺陷，但它与「选择系统 Git CLI 以保留 hooks」的选型理由存在语义落差，必须在文档/UI 中显式承认。
2. `prepare-commit-msg` 拒绝是**唯一**会让一次性 pick 失败（rc=128）的 hook：`error: 'prepare-commit-msg' hook failed` + `fatal: cherry-pick failed`，CPH **保留**，索引留下 `1 A.`（pick 的改动已暂存）。
3. `--continue` 路径会跑 pre-commit / commit-msg。也就是说「首次 pick 绕过 hook、重试/继续时才被 hook 拦截」，行为不一致；UI 文案不能承诺「提交前会检查钩子」。
4. 两步法（`--no-commit` + `commit`）虽然能让 hook 生效，但：
   - 成功后 CPH 不存在，hook 拒绝后状态是「暂存区有 A + `MERGE_MSG`/`AUTO_MERGE` 残留」，与「用户自己 `git add` 了文件」**无法区分**；
   - `--no-commit` 遇冲突 rc=1 且 **不写 CPH、不建 sequencer**，`--continue` / `--abort` 均不可用（hint 也变成「手动 add」），恢复体验明显劣化；
   - 需要应用自己持久化操作日志才能对外解释状态。
5. hook 拒绝后的恢复：`cherry-pick --abort` rc=0，CPH 消失，`hooked.txt` 从工作区移除、暂存清空、HEAD 不变；`--quit` rc=0 **只清标记、保留暂存改动**（用户会看到「凭空多出的已暂存文件」）。因此 UI 必须把「放弃这次 pick（abort）」与「保留改动退出（quit）」区分开，两者都只能由用户点击。

### 4.6 worktree 占用（矩阵 7）

```text
git -C worktree-main switch --no-guess wt-branch -> rc=128
stderr: fatal: 'wt-branch' is already used by worktree at
        'C:/.../worktree-linked'
当前分支仍为 main（未被改变）
加 -f 仍为 128（force 不能夺取其他 worktree 的分支）
switch --no-guess main（当前分支） -> rc=0, stderr "Already on 'main'"
```

`git switch --no-guess topic`（无本地 topic，仅存在 `refs/remotes/origin/topic`）→ rc=128 `fatal: invalid reference: topic`，未创建本地分支，未触发远程猜测。补充实测：本夹具下**不加** `--no-guess` 的 `git switch topic` 同样 rc=128（2.53 的 `switch` 默认不猜测），`git checkout topic` 也返回 `error: pathspec 'topic' did not match any file(s) known to git`（夹具未配置 remote，DWIM 无法复现）。因此 `--no-guess` 的价值是**锁定语义**，不是为了修正 2.53 的默认行为；仍需显式传入，避免未来版本或 `alias`/配置改变默认。

W3 可用的**预检查**（在调用 switch 前把 128 变成可读提示）：

```text
git -C <repo> worktree list --porcelain
worktree C:/.../worktree-main
HEAD f7a8281...
branch refs/heads/main

worktree C:/.../worktree-linked
HEAD f7a8281...
branch refs/heads/wt-branch

# 或一次性拿到占用表：
git -C <repo> for-each-ref --format='%(refname:short) wt=[%(worktreepath)]' refs/heads
main wt=[C:/.../worktree-main]
wt-branch wt=[C:/.../worktree-linked]
```

注意 `switch` 的帮助里存在 `--ignore-other-worktrees`，**禁止使用**（会破坏「同一分支同时只在一个 worktree」的保证）。

### 4.7 dirty 工作区（矩阵 8）

实测表明 dirty **不是**统一拒绝条件，Git 按「路径是否重叠」决定：

| 情形 | 结果 |
|---|---|
| 修改文件与目标分支内容一致 | rc=0，改动被带走（`M tracked.txt` + `Switched to branch`） |
| 修改文件与目标分支内容不同 | rc=1 `Your local changes ... would be overwritten by checkout` / `Aborting` |
| 未跟踪文件将被目标分支覆盖 | rc=1 `The following untracked working tree files would be overwritten by checkout` |
| pick/revert 触及被修改文件 | rc=128 `... would be overwritten by merge` / `Aborting`，**无 CPH/RVH 残留**（分析：干净失败） |
| pick 不触及被修改文件 | 允许执行；若目标提交本身冲突，得到 `1 .M` + `u AA` 并存 |

建议 Gate 文案与策略：

- 有未提交改动时**允许**执行，但确认框显式提示「本地改动可能被 Git 拒绝或被带到目标分支」。
- 不自行 `stash` / `checkout -- .` / `reset`（属于超出白名单的破坏性操作）。
- 对 rc=1/128 的 `would be overwritten` 做稳定错误码映射（`WORKTREE_DIRTY`），UI 文案直接展示被点名的路径。
- 不要试图在前端「预测」是否重叠（需要三方内容比较，成本高且易错）；把判断交给 Git，并把 stderr 收敛为固定提示。

### 4.8 启动时的中断识别与用户选项（矩阵 9）

启动探测顺序（全部只读、参数数组、不经 shell）：

1. `git --version` → 失败则「写操作禁用」（见 5）。
2. `git rev-parse --is-bare-repository`；`true` → 只读模式，不做后续 status 探测（否则 128）。
3. `git rev-parse --show-toplevel` + `--absolute-git-dir` + `--git-common-dir`，用于解析后续相对路径。
4. 依次判断标记：`rebase-merge`（目录）→ `rebase-apply`（目录）→ `REVERT_HEAD` → `CHERRY_PICK_HEAD` → `MERGE_HEAD`。命中即 `Interrupted(kind)`。
5. 无标记时再跑 `git status --porcelain=v2 --branch -z`，统计 `u` 行（`--no-commit` 冲突等无标记场景）与 `1`/`2`/`?` 行（dirty）。
6. `git worktree list --porcelain` 建立分支占用表（W3 预检查）。

状态机（所有动作为用户显式点击；应用绝不自动执行 `--abort` / `--quit` / `--skip`）：

| 识别状态（探测信号） | 含义 | 提供按钮 | 禁止行为 | 实测依据 |
|---|---|---|---|---|
| `Interrupted(rebase)`：`rebase-merge` 目录 | 外部 rebase 停在冲突 | 仅「刷新」「打开终端」 | 任何写操作；应用不实现 rebase 恢复 | 表 3 第 32–33 行 |
| `Interrupted(revert)`：`REVERT_HEAD` + `u` 行 | revert 冲突 | 「继续」（`revert --continue`，需用户先解决冲突）/「放弃回滚」（`revert --abort`）/「退出」 | 自动 abort；自动继续 | 4.3 |
| `Interrupted(cherry-pick 冲突)`：`CPH` + `u` 行 | pick 冲突 | 「继续」/「放弃本次 pick」/「退出」 | 自动 abort/quit | 4.2 |
| `Interrupted(pick 待提交)`：`CPH` 且无 `u` 行、有 `1 A.` | 多为 hook 拒绝（如 prepare-commit-msg）或用户已解决冲突未提交 | 「重试提交」（`cherry-pick --continue`）/「放弃本次 pick」/「退出」 | 自动提交；不得静默清标记 | 表 3 第 18、20 行 |
| `NeedsUserDecision(empty)`：`CPH` 且索引/工作区全干净 | 空 pick（补丁已在上游） | 「跳过该提交」（`cherry-pick --skip`）/「放弃本次 pick」（`--abort`）/「退出」 | 自动 skip；自动 `--quit`；自动 `commit --allow-empty` | 4.4 |
| `Interrupted(no-marker)`：无标记但存在 `u` 行 | `--no-commit` 冲突或外部残留 | 只读 + 终端提示 | 猜测为 pick 中断并调用 `--continue`（会失败） | 表 3 第 23 行 |
| `Ready(dirty)`：无标记，有 `1`/`2`/`?` 行 | 用户未提交改动 | 允许写操作 + 风险确认 | 自动 stash/reset | 4.7 |
| `Ready` | 干净 | 允许写操作 | — | 4.1 |

关键约束：**空 pick 与「pick 待提交」在 porcelain 中完全无痕**，若 Gate 只用 status，会把中断态误判为 `Ready`（本次验证中确实发生了一次假阴性）。因此标记文件检查是硬性前置。

### 4.9 版本下限（矩阵 10）

```text
$ git --version
git version 2.53.0.windows.2
```

- 版本串带 `windows.2` 后缀，解析必须只取前三段数字（`sed -E 's/^git version ([0-9]+)\.([0-9]+)\.([0-9]+).*/\1 \2 \3/'` → `2 53 0`）；直接按 `-`/空格切分或要求 `x.y.z` 全等会误判。
- 本机可用能力（实测通过）：`switch --no-guess`（`-h` 中列出 `--[no-]guess`）、`status --porcelain=v2 --branch`、`rev-parse --show-object-format`（sha1/sha256 均正确）、`rev-parse --absolute-git-dir`、`rev-parse --git-path`、`merge-base --is-ancestor`（rc=0/1 语义正确）、`cherry-pick --empty=(stop|drop|keep)`（`--allow-empty` 已标注 deprecated）。
- `docs/02-选型终审.md` 只写「低于最终最低版本」，未给数字。**建议最低版本 ≥ 2.40**：覆盖 `switch --no-guess`（2.23 起）、porcelain v2（2.11 起）、`--absolute-git-dir`（2.13 起）与近年的 `advice.*` 默认输出稳定性；若 W2 要使用 `--empty=drop|keep`（约 2.45 起）则须把下限提到 2.45 或做能力探测。
- 旧版本行为**未实测**（本机仅 2.53）：上条中括号内的引入版本来自 Git 文档记忆，本次无法用旧二进制复核，标记为「未实测，需在 CI 补一台旧版本矩阵」。
- Git 缺失路径：`PATH` 为空时 `git --version` → `command not found`，rc=127；Rust 侧 `Command::new("git")` 会得到 `ERROR_FILE_NOT_FOUND`。两种情况都必须映射为「只读可用、写操作禁用」的启动态，而不是崩溃。
- **身份缺失是独立的写前失败点**：夹具用环境变量注入作者、未写 local config，此时 `git commit` / `cherry-pick` 直接 **rc=128** 并输出 `Author identity unknown` + 多行 `*** Please tell me who you are.`。Gate 应在执行前用 `git config --get user.name` / `user.email`（或 `git var GIT_AUTHOR_IDENT`）预检，给出「请先配置 Git 身份」的稳定错误码，而不是把多行英文提示直接透给用户。

## 5. 否决条件判定

| 条件（`02-选型终审.md`） | 本次实测 | 判定 |
|---|---|---|
| 系统 Git 缺失 | 存在，`git --version` rc=0 | 未触发 |
| 系统 Git 低于最低版本 | 2.53.0.windows.2 ≥ 建议下限 2.40 | 未触发 |
| SHA-256 仓库写路径受阻 | `--show-object-format` 正确返回 `sha256`，`--git-path` 形态与 sha1 仓库一致 | 未触发 |

结论：**V4 准入通过**，无需按否决条件收紧 MVP。但需接受两条已知语义落差（不改变选型，仅登记）：① 一次性 `cherry-pick` 绕过 pre-commit / commit-msg；② 空 pick 与 hook 拒绝在 porcelain 中不可见，Gate 必须依赖标记文件。

## 6. 对 W1 / W2 / W3 的直接结论

**W1（Gate 与互斥）**

1. Gate 必须由三部分组成，缺一不可：标记文件（`--git-path` 解析后判存在）+ porcelain v2（`u` 行与 `1/2/?` 行）+ 仓库属性（`--is-bare-repository`、`--show-object-format`、`--git-version`）。
2. 严格禁止把 `AUTO_MERGE`（成功 pick 后仍残留）或 `MERGE_MSG` 当作中断标记。
3. `--git-path` 的相对结果必须与 `--show-toplevel` 拼接（bare 用 `--absolute-git-dir`）；或让所有子进程 cwd 固定为 toplevel。已实测该拼接缺失会造成假阴性。
4. 只允许 5 个标记 + `sequencer`（多提交范围 pick 中断时存在：`abort-safety`/`head`/`todo`）。
5. 单一「写操作锁」应覆盖 Gate→执行→复检全过程；冲突态下 Git 自身返回 128，Gate 的价值是提前给出可读原因，因此复检失败必须回落到「重新读状态」而不是直接报错。
6. Gate 还应预检 Git 身份（`user.name` / `user.email`），否则首次写操作会以 rc=128 `Author identity unknown` 失败（实测，见 4.9）。

**W2（cherry-pick / revert）**

1. 采用**一次性** `git cherry-pick <oid>` / `git revert --no-edit <oid>`（默认 `--empty=stop` 行为），不要引入 `--no-commit` 两步法：后者破坏 CPH 契约、冲突后无 `--continue/--abort`，恢复成本高于收益。
2. 把「pre-commit / commit-msg 不会被一次性 pick 触发」写入 UI 帮助与验收标准；不要宣称「提交前钩子一定执行」。`--continue` 时会触发，文案需避免前后矛盾。
3. 状态映射：rc=0 → `Succeeded`；rc=1 且有 `u` 行 → `Conflicted`；rc=1 且无 `u` 行但有 `CPH` → `NeedsUserDecision(empty)`；rc=128 且 stderr 含 `hook failed` → `HookRejected`；rc=128 且 stderr 含 `would be overwritten` → `Blocked(dirty)`；rc=128 且 stderr 含 `unmerged files`/`cannot switch branch while` → `Blocked(interrupted)`。
4. 空 pick 文案建议：「该提交的改动在当前分支已存在，未产生新提交」，按钮：跳过 / 放弃本次 pick / 退出。不得自动 `--skip`、`--quit` 或 `commit --allow-empty`。
5. hook 拒绝文案建议直接展示 hook 的 stderr（诊断详情），并列明「放弃本次 pick」会丢弃已暂存改动、「退出保留」会留下暂存改动。

**W3（切换分支）**

1. 调用前用 `worktree list --porcelain`（或 `for-each-ref %(worktreepath)`）预判占用，命中即返回 `Blocked(worktree)` 并显示占用路径；不要依赖 switch 的 128。
2. 始终传 `--no-guess`；禁止 `--ignore-other-worktrees`、`--force`、`--discard-changes`。
3. dirty 不预拒绝：允许执行，把 rc=1 的 `would be overwritten` 映射为 `WORKTREE_DIRTY` 并展示被点名路径；rc=0 且 stdout 有 `M <path>` 时提示「本地改动已带到目标分支」。
4. 中断态（任何标记存在）下 switch 必然 128（`cannot switch branch while cherry-picking/reverting/rebasing`），因此 `Interrupted` 优先级必须高于 switch 入口。

## 7. 未覆盖 / 待补验证

- 旧版 Git（< 2.40）行为未实测，最低版本结论依赖建议值而非二进制矩阵。
- hook 使用 `sh` 实现；`.cmd`/`.exe` hook、`core.hooksPath` 自定义路径、hook 超时与交互式 hook 未验证。
- 非 ASCII / 含空格路径与 `core.quotepath` 对 porcelain v2 的影响未验证（建议后续一律用 `-z`）。
- 子模块、LFS、`core.autocrlf=true` 下的写路径未验证（夹具固定 `autocrlf=false`）。
- 未验证 `git cherry-pick` 在 `GIT_EDITOR` 缺失时的行为（本验证统一走非交互命令，`revert` 使用 `--no-edit`）。
- 未验证多 worktree 下同一分支被 `git branch --list` 标记的 `+` 前缀解析（改用 `%(worktreepath)` 更稳）。

## 8. 复现命令

```bash
# 生成夹具（只读使用）
export PATH="$USERPROFILE/.cargo/bin:$PATH"
cd /c/zy/project_other/ai-projects/git-graph
cargo run -q -p fixture-gen -- target/v4

# 复制到临时目录（示例）
T="$TEMP/v4-gate-$$"; mkdir -p "$T"
for d in linear forked conflict empty-pick hook-reject dirty bare worktree-main worktree-linked; do
  cp -r target/v4/$d "$T/$d"
done
# 写操作需要身份；夹具用环境变量注入作者，未写进 local config
for d in conflict empty-pick hook-reject dirty; do
  git -C "$T/$d" config user.name "V4 Tester"
  git -C "$T/$d" config user.email "v4@example.com"
done
# worktree 副本需改写指针，否则指向原始夹具（详见第 1 节）

# 冲突 pick
git -C "$T/conflict" cherry-pick feature; echo "rc=$?"
git -C "$T/conflict" rev-parse --git-path CHERRY_PICK_HEAD
git -C "$T/conflict" diff --name-only --diff-filter=U
git -C "$T/conflict" status --porcelain=v2 --branch
# 恢复（仅手动实验）
git -C "$T/conflict" cherry-pick --abort

# 空 pick
git -C "$T/empty-pick" cherry-pick source; echo "rc=$?"
test -e "$T/empty-pick/$(git -C "$T/empty-pick" rev-parse --git-path CHERRY_PICK_HEAD)" && echo "CPH 残留"

# hook 绕过
git -C "$T/hook-reject" commit --allow-empty -m probe; echo "rc=$?"   # 1，hook 生效
git -C "$T/hook-reject" cherry-pick pick-source; echo "rc=$?"        # 0，hook 被绕过

# worktree 占用
git -C "$T/worktree-main" switch --no-guess wt-branch; echo "rc=$?"   # 128
git -C "$T/worktree-main" worktree list --porcelain
```
