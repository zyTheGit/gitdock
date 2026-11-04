import { i18next } from "../../i18n";
import { outcomeText } from "../../shared/error";
import type { WriteKind, WriteOutcomeDto } from "../../shared/types";

/** 跳过命令是 Git 字面量而非文案，双语一致，不进资源。 */
const SKIP_COMMAND: Record<"cherry_pick" | "revert", string> = {
  cherry_pick: "git cherry-pick --skip",
  revert: "git revert --skip",
};

const SKIP_BOTH_COMMANDS = "git cherry-pick --skip / git revert --skip";

/** 操作名：与确认框共用同一组 label* key。 */
function writeLabel(kind: WriteKind): string {
  switch (kind) {
    case "cherry_pick":
      return i18next.t("write.labelCherryPick");
    case "revert":
      return i18next.t("write.labelRevert");
    case "switch_branch":
      return i18next.t("write.labelSwitchBranch");
    case "set_branch_description":
      return i18next.t("write.labelSetBranchDescription");
    case "stage_files":
      return i18next.t("write.labelStageFiles");
    case "unstage_files":
      return i18next.t("write.labelUnstageFiles");
    case "continue_operation":
      return i18next.t("write.labelContinueOperation");
    case "abort_operation":
      return i18next.t("write.labelAbortOperation");
    case "create_commit":
      return i18next.t("write.labelCreateCommit");
    case "amend_commit":
      return i18next.t("write.labelAmendCommit");
  }
}

/** 写操作结果 → 状态栏文案；failed 的详情仍由调用方以错误横幅展示。 */
export function outcomeMessage(
  kind: WriteKind,
  outcome: WriteOutcomeDto,
  branch?: string,
  interruption?: "cherry_pick" | "revert",
): string {
  // Rust 侧已带 i18n key（errors 域，含全部插值）时优先使用；
  // 缺失翻译回落下方的 status 分支生成（write 域）。
  const byKey = outcome.key ? outcomeText(outcome) : null;
  if (byKey && byKey !== outcome.message) return byKey;
  switch (outcome.status) {
    case "succeeded":
      if (kind === "switch_branch") {
        return i18next.t("write.outcomeSwitchedToBranch", { branch: branch ?? "" });
      }
      if (kind === "continue_operation") {
        return i18next.t("write.outcomeContinueDone");
      }
      if (kind === "abort_operation") {
        return i18next.t("write.outcomeAbortDone");
      }
      // 提交类成功优先用 errors 域 key（带新提交短 oid）；Rust 未带 key 时由此回落。
      if (kind === "create_commit") {
        return i18next.t("errors.outcomeCommitSucceeded", { oid: outcome.args?.oid ?? "" });
      }
      if (kind === "amend_commit") {
        return i18next.t("errors.outcomeAmendSucceeded", { oid: outcome.args?.oid ?? "" });
      }
      return i18next.t("write.outcomeSucceeded", { label: writeLabel(kind) });
    case "empty_pick":
      // 后端已以 EmptyPick 状态结构化判定空结果（单次操作已自动清理），
      // 不再对 message 内容做反向解析。
      return i18next.t("write.outcomeEmptyPick");
    case "conflicted":
      return i18next.t("write.outcomeConflicted");
    case "rejected":
      return i18next.t("write.outcomeRejected");
    default: {
      // failed：只翻译人写前缀，后端 message 原样作为参数。
      const base = i18next.t("write.outcomeFailed", {
        label: writeLabel(kind),
        message: outcome.message,
      });
      if (kind !== "continue_operation") {
        return base;
      }
      // 空结果结论已由 empty_pick 状态在上方分流（不解析 message 内容）；
      // 走到这里说明结论缺少跳过指引，统一补一句终端命令，不提供自动跳过。
      const skip = interruption ? SKIP_COMMAND[interruption] : SKIP_BOTH_COMMANDS;
      return i18next.t("write.outcomeFailedWithSkip", { base, skip });
    }
  }
}
