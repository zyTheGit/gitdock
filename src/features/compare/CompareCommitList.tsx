import type { MouseEvent } from "react";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto } from "../../shared/types";

interface CompareCommitListProps {
  commits: CommitSummaryDto[];
  truncated: boolean;
  onOpen: (oid: string) => void;
  onContextMenu: (event: MouseEvent, commit: CommitSummaryDto) => void;
}

export function CompareCommitList({
  commits,
  truncated,
  onOpen,
  onContextMenu,
}: CompareCommitListProps) {
  return (
    <div className="compare-commits">
      <h3>
        Compare 引入的提交（{commits.length}
        {truncated ? "+" : ""}）
      </h3>
      {commits.length === 0 ? (
        <p className="muted">Compare 没有相对共同祖先的新提交。</p>
      ) : (
        <ul className="compare-commit-list">
          {commits.map((commit) => (
            <li key={commit.oid}>
              <button
                onClick={() => onOpen(commit.oid)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu(event, commit);
                }}
                title={commit.oid}
              >
                <span className="compare-commit-summary">{commit.summary}</span>
                <span className="mono muted">{commit.short_oid}</span>
                <span className="muted">{formatDate(commit.authored_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
