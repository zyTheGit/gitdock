import { useI18n } from "../../i18n";
import type { CompareResultDto } from "../../shared/types";
import { isWorktreeSlot, type CompareSlot } from "./useCompare";

interface CompareHeaderProps {
  base: CompareSlot;
  compare: CompareSlot;
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  result: CompareResultDto | null;
  totalAdd: number;
  totalDel: number;
  toolCount: number;
  onDirectoryDiff: () => void;
  onBack: () => void;
}

export function CompareHeader({
  base,
  compare,
  twoDot,
  onTwoDotChange,
  result,
  totalAdd,
  totalDel,
  toolCount,
  onDirectoryDiff,
  onBack,
}: CompareHeaderProps) {
  const { t } = useI18n();
  // 工作区没有提交历史，没有共同祖先可算：三点模式不可选，标题也按快照语义展示。
  const worktree = isWorktreeSlot(base) || isWorktreeSlot(compare);
  const snapshot = twoDot || worktree;
  const slotText = (slot: CompareSlot) =>
    isWorktreeSlot(slot) ? slot.label : `${slot.label} (${slot.oid.slice(0, 8)})`;
  const modeLabel: Record<CompareResultDto["mode"], string> = {
    three_dot: t("compare.modeThreeDot"),
    two_dot: t("compare.modeTwoDot"),
    two_dot_fallback: t("compare.modeTwoDotFallback"),
    worktree: t("compare.modeWorktree"),
  };
  return (
    <header className="compare-header">
      <div>
        <h2>{snapshot ? t("compare.titleTwoDot") : t("compare.titleThreeDot")}</h2>
        <div className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
          {slotText(base)} → {slotText(compare)}
        </div>
      </div>
      <div className="compare-meta">
        <div className="diff-mode" role="group" aria-label={t("compare.modeGroup")}>
          <button
            className={snapshot ? "" : "active"}
            onClick={() => onTwoDotChange(false)}
            disabled={worktree}
            title={worktree ? t("compare.modeWorktreeHint") : t("compare.modeThreeDotHint")}
          >
            {t("compare.modeThreeDot")}
          </button>
          <button
            className={snapshot ? "active" : ""}
            onClick={() => onTwoDotChange(true)}
            title={t("compare.modeTwoDotHint")}
          >
            {t("compare.modeTwoDot")}
          </button>
        </div>
        <span className={result?.mode === "two_dot_fallback" ? "tag warn" : "tag"}>
          {result ? modeLabel[result.mode] : t("compare.modeThreeDot")}
        </span>
        {result && (
          <>
            <span className="muted">
              {t("compare.sideCounts", {
                baseOnly: result.base_only,
                compareOnly: result.compare_only,
              })}
            </span>
            <span className="diff-add">+{totalAdd}</span>
            <span className="diff-del">-{totalDel}</span>
          </>
        )}
        <button
          onClick={onDirectoryDiff}
          disabled={!result || toolCount === 0 || worktree}
          title={
            worktree
              ? t("compare.directoryDiffWorktreeHint")
              : toolCount === 0
                ? t("compare.noExternalTool")
                : t("compare.directoryDiffHint")
          }
        >
          {t("compare.directoryDiff")}
        </button>
        <button onClick={onBack}>{t("compare.viewGraph")}</button>
      </div>
    </header>
  );
}
