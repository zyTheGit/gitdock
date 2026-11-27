import { useI18n } from "../../i18n";
import type { CompareResultDto } from "../../shared/types";
import { classifyCompareRelation, summarizeCompareFiles, type CompareRelationKind } from "./compareSummary";
import { isWorktreeSlot, type CompareSlot } from "./useCompare";

interface CompareHeaderProps {
  base: CompareSlot;
  compare: CompareSlot;
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  result: CompareResultDto | null;
  totalAdd: number;
  totalDel: number;
  onLocateCommit: (oid: string) => void;
  onBack: () => void;
}

const BADGE_CLASS: Record<CompareRelationKind, string> = {
  fast_forward: "compare-relation-badge ok",
  behind: "compare-relation-badge warn",
  diverged: "compare-relation-badge accent",
  same_commit: "compare-relation-badge",
  no_common_ancestor: "compare-relation-badge warn",
  two_dot: "compare-relation-badge",
  worktree: "compare-relation-badge",
};

export function CompareHeader({
  base,
  compare,
  twoDot,
  onTwoDotChange,
  result,
  totalAdd,
  totalDel,
  onLocateCommit,
  onBack,
}: CompareHeaderProps) {
  const { t } = useI18n();
  // 工作区没有提交历史，没有共同祖先可算：三点模式不可选，标题也按快照语义展示。
  const worktree = isWorktreeSlot(base) || isWorktreeSlot(compare);
  const snapshot = twoDot || worktree;
  const sameCommit = !worktree && base.oid === compare.oid;

  const relation = classifyCompareRelation({
    sameCommit,
    worktree,
    twoDot,
    mode: result?.mode ?? null,
    baseOnly: result?.base_only ?? 0,
    compareOnly: result?.compare_only ?? 0,
  });

  const fileStats = result ? summarizeCompareFiles(result.files) : null;

  const badgeText: Record<CompareRelationKind, string> = {
    fast_forward: t("compare.badgeFastForward"),
    behind: t("compare.badgeBehind"),
    diverged: t("compare.badgeDiverged"),
    same_commit: t("compare.badgeSameCommit"),
    no_common_ancestor: t("compare.badgeNoAncestor"),
    two_dot: t("compare.badgeTwoDot"),
    worktree: t("compare.badgeWorktree"),
  };

  const headline = (() => {
    switch (relation.kind) {
      case "fast_forward":
        return t("compare.summaryFastForward", {
          base: base.label,
          compare: compare.label,
          n: relation.compareOnly,
        });
      case "behind":
        return t("compare.summaryBehind", {
          base: base.label,
          compare: compare.label,
          n: relation.baseOnly,
        });
      case "diverged":
        return t("compare.summaryDiverged", {
          base: base.label,
          compare: compare.label,
          baseOnly: relation.baseOnly,
          compareOnly: relation.compareOnly,
        });
      case "same_commit":
        return t("compare.summarySameCommit", {
          base: base.label,
          compare: compare.label,
        });
      case "no_common_ancestor":
        return t("compare.summaryNoAncestor", {
          base: base.label,
          compare: compare.label,
        });
      case "two_dot":
      case "worktree":
        return t("compare.summarySnapshot", {
          base: base.label,
          compare: compare.label,
        });
    }
  })();

  const slotText = (slot: CompareSlot) =>
    isWorktreeSlot(slot) ? slot.label : `${slot.label} (${slot.oid.slice(0, 8)})`;

  return (
    <header className="compare-summary-card">
      <div className="compare-summary-top">
        <div className="compare-summary-main">
          <div className="compare-summary-headline">
            <span className={BADGE_CLASS[relation.kind]}>{badgeText[relation.kind]}</span>
            <h2 title={`${slotText(base)} → ${slotText(compare)}`}>{headline}</h2>
          </div>
          <div className="compare-summary-sub">
            <span className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
              {slotText(base)} → {slotText(compare)}
            </span>
            {result?.merge_base && (
              <button
                type="button"
                className="compare-merge-base-btn mono"
                onClick={() => onLocateCommit(result.merge_base!)}
                title={
                  result.merge_base_summary
                    ? t("compare.mergeBaseHintWithSummary", {
                        oid: result.merge_base.slice(0, 8),
                        summary: result.merge_base_summary,
                      })
                    : t("compare.mergeBaseHint", { oid: result.merge_base.slice(0, 8) })
                }
              >
                {t("compare.mergeBaseLabel", { oid: result.merge_base.slice(0, 8) })}
              </button>
            )}
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
              {t("compare.modeThreeDotShort")}
            </button>
            <button
              className={snapshot ? "active" : ""}
              onClick={() => onTwoDotChange(true)}
              title={t("compare.modeTwoDotHint")}
            >
              {t("compare.modeTwoDotShort")}
            </button>
          </div>
          <button onClick={onBack}>{t("compare.viewGraph")}</button>
        </div>
      </div>

      {result && (
        <div className="compare-summary-bottom">
          {relation.showRatioBar && (
            <div
              className="compare-ratio"
              title={t("compare.sideCounts", {
                baseOnly: relation.baseOnly,
                compareOnly: relation.compareOnly,
              })}
            >
              <span className="compare-ratio-label">
                {base.label} -{relation.baseOnly}
              </span>
              <div className="compare-ratio-track" aria-hidden="true">
                {relation.baseOnly > 0 && (
                  <span
                    className="compare-ratio-base"
                    style={{ width: `${relation.basePct}%` }}
                  />
                )}
                {relation.compareOnly > 0 && (
                  <span
                    className="compare-ratio-compare"
                    style={{ width: `${relation.comparePct}%` }}
                  />
                )}
              </div>
              <span className="compare-ratio-label">
                +{relation.compareOnly} {compare.label}
              </span>
            </div>
          )}

          {fileStats && (
            <div className="compare-file-stats">
              <span className="muted">
                {t("compare.changedFilesCount", { n: fileStats.total })}
              </span>
              {fileStats.added > 0 && <span className="stat-chip stat-add">A {fileStats.added}</span>}
              {fileStats.modified > 0 && (
                <span className="stat-chip stat-mod">M {fileStats.modified}</span>
              )}
              {fileStats.deleted > 0 && (
                <span className="stat-chip stat-del">D {fileStats.deleted}</span>
              )}
              {fileStats.renamed > 0 && (
                <span className="stat-chip stat-ren">R {fileStats.renamed}</span>
              )}
              {fileStats.bothCount > 0 && (
                <span className="stat-chip stat-both">
                  {t("compare.bothChangedCount", { n: fileStats.bothCount })}
                </span>
              )}
              <span className="diff-add">+{totalAdd}</span>
              <span className="diff-del">-{totalDel}</span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
