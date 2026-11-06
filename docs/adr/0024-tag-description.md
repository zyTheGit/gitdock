# ADR 0024：标签描述——附注标签消息即描述

- 状态：已接受（2026-11-06 实现）
- 日期：2026-11-06
- 影响范围：`crates/git-core/src/dto.rs`（WriteKind）、`crates/git-read/src/read/refs.rs`、`crates/git-write`（tag.rs / tag/gate.rs / command.rs / execute.rs / gate.rs / 新增 probe.rs）、`src/shared/types.ts`、`src/features/repository/branchMenus.ts`、`src/app/useCommitMenus.ts`、`src/app/RepositorySidebar.tsx`、新增 `src/features/write/TagDescriptionDialog.tsx`、`src/App.tsx`、i18n（write/repository/errors）
- 触发依据：用户需求「标签也需要支持右键编辑描述，参考分支」

## 1. 背景

分支描述已通过 `branch.<name>.description` 本地配置提供（右键「编辑描述」）。用户要求标签具备同样的右键入口。Git 轻量标签没有消息字段，附注标签则以 tag 对象的 message 承载说明文本；用户明确希望描述能随标签推送远程，因此不能像分支描述那样只存本地配置。

## 2. 决策

1. **描述载体**：标签描述 = 附注标签的 message。轻量标签没有描述（读取为 `None`）。
2. **读取**：`git-read` 在 `read_refs` 中按引用目标对象区分——tag 对象解出 tagger 时间与 message 作为 `created_at` / `description`；commit 对象保持原提交时间、描述为空。前端直接复用 `RepoStateDto.refs` 已有的 `RefDto.description`，不新增 IPC 命令。
3. **写入**：`WriteKind` 新增 `set_tag_description`，复用 `branch` 字段承载标签名、`description` 承载文本：
   - 非空：`git tag -f -a --message=<文本> <name> refs/tags/<name>^{commit}`，重建附注标签。
   - 空/纯空白：`git tag -f <name> refs/tags/<name>^{commit}`，回退为轻量标签。
   - 目标统一用 `^{commit}` peel 表达式，保证已有附注标签被解析到提交而不是写回自身。
4. **Gate**（`tag/gate.rs::validate_set_description`）：标签存在且 peel 后为 commit；描述允许换行与制表符，拒绝其余控制字符（含 NUL）；摘要区分「重写附注描述」与「清除描述并改为轻量标签」。
5. **只改本地**：不自动 push、不调用任何远程写命令。已推送到远端的同名标签不会自动更新；对话框明确提示需要用户自行执行 `git push --force origin <tag>`。
6. **UI**：标签右键菜单新增「编辑描述」（无 `commit_oid` 时禁用），打开 `TagDescriptionDialog`；保存按钮在文本未变化时禁用，避免无意义的标签对象重建。侧栏标签项展示描述。

## 3. 备选方案（未采纳）

| 方案 | 不采纳原因 |
|---|---|
| 与分支一致存 `local config` | 描述不随标签推送远程，与用户「希望推送」的预期不符 |
| 只允许编辑已有附注标签，轻量标签不升级 | 用户需要给任意标签写描述；轻量→附注是最直观的语义 |
| 编辑后自动 `push --force` | 属于不可逆的共享状态变更，不应在描述编辑中隐式触发；用户选择「只改本地标签」 |
| 新建独立读取命令返回标签消息 | `RepoStateDto.refs` 已携带描述，新增 seam 无收益 |

## 4. 后果与边界

- `WriteKind` 契约新增一个变体，`types.ts` 同步；标签对象会在编辑时重建（OID 变化，指向的提交不变）。
- 与 ADR-0008「标签只操作本地 refs」一致：本次仍不提供远程写，描述推送由用户显式完成。
- 删除描述会把附注标签降级为轻量标签，属于有损操作，Gate 摘要与结果文案均明确说明。
- 控制字符校验同时用于 Gate 与命令构造兜底，防止绕过 Gate 的调用方写入非法对象。

## 5. 验收

1. 附注标签右键「编辑描述」显示现有 message，保存后 `for-each-ref --format=%(contents)` 内容更新、指向提交不变。
2. 轻量标签编辑描述后 `cat-file -t` 变为 tag，`^{commit}` 仍指向原提交。
3. 清空描述后标签回退为轻量标签（`cat-file -t` 为 commit）。
4. 不存在的标签、指向 tree/blob 的标签在 Gate 被拒绝；含 NUL 的描述被拒绝。
5. 远端已有同名标签时本地重写不触发 push，对话框提示 `git push --force origin <tag>`。
6. `npm run check` 全绿；触及文件行数合规。
