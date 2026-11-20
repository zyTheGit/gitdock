import type { useI18n } from "../../i18n";
import type { InterruptionKind } from "../../shared/types";

type Translate = ReturnType<typeof useI18n>["t"];

/** ours / theirs 在界面上代表哪一侧；只用于文案，不参与校验。 */
export interface ConflictSideLabels {
  /** true 表示 rebase 中断（Git 语义反转：ours = 上游 / onto 一侧）。 */
  inverted: boolean;
  /** ours 一侧的中文 / 英文说明，用于按钮与确认框。 */
  ours: string;
  /** theirs 一侧的说明。 */
  theirs: string;
}

/**
 * 按中断类型给出 ours / theirs 的界面语义（ADR-0033 §3.1）：
 * rebase（含 pull --rebase）下 `--ours` 是目标分支（上游）一侧、`--theirs` 是
 * 正在重放的提交；merge / cherry-pick / revert / sequencer 沿用 merge 语义。
 * 这是前端唯一需要 Git 语义知识的地方，且只影响文案。
 */
export function conflictSideLabels(
  t: Translate,
  kinds: readonly InterruptionKind[],
): ConflictSideLabels {
  if (kinds.includes("rebase")) {
    return {
      inverted: true,
      ours: t("staging.conflictSideUpstream"),
      theirs: t("staging.conflictSideReplayed"),
    };
  }
  return {
    inverted: false,
    ours: t("staging.conflictSideCurrent"),
    theirs: t("staging.conflictSideIncoming"),
  };
}
