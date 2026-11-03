import { useI18n } from "../../i18n";
import type { CompareResultDto } from "../../shared/types";
import type { CompareSlot } from "./useCompare";

interface CompareHeaderProps {
  base: CompareSlot;
  compare: CompareSlot;
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  result: CompareResultDto | null;
  totalAdd: number;
  totalDel: number;
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
  onBack,
}: CompareHeaderProps) {
  const { t } = useI18n();
  const modeLabel: Record<CompareResultDto["mode"], string> = {
    three_dot: t("compare.modeThreeDot"),
    two_dot: t("compare.modeTwoDot"),
    two_dot_fallback: t("compare.modeTwoDotFallback"),
  };
  return (
    <header className="compare-header">
      <div>
        <h2>{twoDot ? t("compare.titleTwoDot") : t("compare.titleThreeDot")}</h2>
        <div className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
          {base.label} ({base.oid.slice(0, 8)}) → {compare.label} ({compare.oid.slice(0, 8)})
        </div>
      </div>
      <div className="compare-meta">
        <div className="diff-mode" role="group" aria-label={t("compare.modeGroup")}>
          <button
            className={twoDot ? "" : "active"}
            onClick={() => onTwoDotChange(false)}
            title={t("compare.modeThreeDotHint")}
          >
            {t("compare.modeThreeDot")}
          </button>
          <button
            className={twoDot ? "active" : ""}
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
        <button onClick={onBack}>{t("compare.viewGraph")}</button>
      </div>
    </header>
  );
}
