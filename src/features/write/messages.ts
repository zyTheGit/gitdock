import type { WriteKind, WriteOutcomeDto } from "../../shared/types";

const WRITE_LABEL: Record<WriteKind, string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
  switch_branch: "切换分支",
  set_branch_description: "更新分支描述",
  stage_files: "暂存文件",
  unstage_files: "取消暂存",
};

/** 写操作结果 → 状态栏文案；failed 的详情仍由调用方以错误横幅展示。 */
export function outcomeMessage(kind: WriteKind, outcome: WriteOutcomeDto, branch?: string): string {
  switch (outcome.status) {
    case "succeeded":
      return kind === "switch_branch"
        ? `已切换到分支 ${branch ?? ""}`
        : `${WRITE_LABEL[kind]} 成功，已刷新图谱`;
    case "empty_pick":
      return "无变更（空 pick），已清理本次操作状态";
    case "conflicted":
      return "发生冲突，请在终端处理；本应用不会自动 abort";
    case "rejected":
      return "写前检查未通过，未执行";
    default:
      return `${WRITE_LABEL[kind]} 失败：${outcome.message}`;
  }
}
