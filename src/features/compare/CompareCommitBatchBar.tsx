import { useI18n } from "../../i18n";
import type { CommitSummaryDto } from "../../shared/types";

interface CompareCommitBatchBarProps {
  selectedCommits: CommitSummaryDto[];
  batchMode: boolean;
  writeDisabled: boolean;
  onCherryPick?: (commit: CommitSummaryDto) => void;
  onRevert?: (commit: CommitSummaryDto) => void;
  onBatchCherryPick?: (commits: CommitSummaryDto[]) => void;
  onBatchRevert?: (commits: CommitSummaryDto[]) => void;
  onClear: () => void;
  onExitBatchMode: () => void;
}

/** 对比视图按提交页的多选批量操作栏：1 条走单提交，2 条及以上走批量序列。 */
export function CompareCommitBatchBar({
  selectedCommits,
  batchMode,
  writeDisabled,
  onCherryPick,
  onRevert,
  onBatchCherryPick,
  onBatchRevert,
  onClear,
  onExitBatchMode,
}: CompareCommitBatchBarProps) {
  const { t } = useI18n();
  if (!batchMode && selectedCommits.length === 0) {
    return null;
  }

  return (
    <div className="commit-explorer-batch-bar" role="region" aria-label={t("graph.batchBarAria")}>
      <span className="commit-explorer-batch-count">
        {selectedCommits.length > 0
          ? t("graph.batchSelectedCount", { n: selectedCommits.length })
          : t("graph.batchEmptyHint")}
      </span>
      <div className="commit-explorer-batch-actions">
        {selectedCommits.length === 1 && onCherryPick && (
          <button
            type="button"
            disabled={writeDisabled}
            onClick={() => onCherryPick(selectedCommits[0])}
          >
            {t("graph.menuCherryPick")}
          </button>
        )}
        {selectedCommits.length >= 2 && onBatchCherryPick && (
          <button
            type="button"
            disabled={writeDisabled}
            onClick={() => onBatchCherryPick(selectedCommits)}
          >
            {t("graph.menuBatchCherryPick", { n: selectedCommits.length })}
          </button>
        )}
        {selectedCommits.length === 1 && onRevert && (
          <button
            type="button"
            disabled={writeDisabled}
            onClick={() => onRevert(selectedCommits[0])}
          >
            {t("graph.menuRevert")}
          </button>
        )}
        {selectedCommits.length >= 2 && onBatchRevert && (
          <button
            type="button"
            disabled={writeDisabled}
            onClick={() => onBatchRevert(selectedCommits)}
          >
            {t("graph.menuBatchRevert", { n: selectedCommits.length })}
          </button>
        )}
        {selectedCommits.length > 0 && (
          <button type="button" className="link" onClick={onClear}>
            {t("graph.batchClear")}
          </button>
        )}
        {batchMode && (
          <button type="button" className="link" onClick={onExitBatchMode}>
            {t("graph.batchExit")}
          </button>
        )}
      </div>
    </div>
  );
}
