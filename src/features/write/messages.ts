import type { WriteKind, WriteOutcomeDto } from "../../shared/types";

const WRITE_LABEL: Record<WriteKind, string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
  switch_branch: "切换分支",
  set_branch_description: "更新分支描述",
  stage_files: "暂存文件",
  unstage_files: "取消暂存",
  continue_operation: "继续操作",
  abort_operation: "中止操作",
};

const SKIP_COMMAND: Record<"cherry_pick" | "revert", string> = {
  cherry_pick: "git cherry-pick --skip",
  revert: "git revert --skip",
};

/** 写操作结果 → 状态栏文案；failed 的详情仍由调用方以错误横幅展示。 */
export function outcomeMessage(
  kind: WriteKind,
  outcome: WriteOutcomeDto,
  branch?: string,
  interruption?: "cherry_pick" | "revert",
): string {
  switch (outcome.status) {
    case "succeeded":
      if (kind === "switch_branch") {
        return `已切换到分支 ${branch ?? ""}`;
      }
      if (kind === "continue_operation") {
        return "已继续并完成操作，已刷新图谱";
      }
      if (kind === "abort_operation") {
        return "已中止操作并回到操作前状态，已刷新图谱";
      }
      return `${WRITE_LABEL[kind]} 成功，已刷新图谱`;
    case "empty_pick":
      return "无变更（空 pick），已清理本次操作状态";
    case "conflicted":
      return "发生冲突：请到终端解决并 git add。本应用只对单次 cherry-pick / revert 提供「继续」「中止」，且只在你点击并确认后执行，不会自动 --abort / --quit / --skip。";
    case "rejected":
      return "写前检查未通过，未执行";
    default: {
      const base = `${WRITE_LABEL[kind]} 失败：${outcome.message}`;
      if (kind !== "continue_operation") {
        return base;
      }
      // 空结果继续时后端已在 message 里给出 --skip 提示；这里只为缺少该提示的结论补一句，
      // 仍只指向终端命令，不提供自动跳过。
      if (outcome.message.includes("--skip")) {
        return base;
      }
      const skip = interruption ? SKIP_COMMAND[interruption] : "git cherry-pick --skip / git revert --skip";
      return `${base}；若 Git 报告结果为空，需在终端执行 ${skip} 跳过本次操作（本应用不会自动跳过）`;
    }
  }
}
