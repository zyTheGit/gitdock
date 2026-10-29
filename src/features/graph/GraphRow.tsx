import type { MouseEvent } from "react";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto, RefBadgeDto, RowLayoutDto } from "../../shared/types";
import { GraphCell } from "./GraphCell";

function badgeClass(badge: RefBadgeDto): string {
  const parts = ["ref-badge", `ref-${badge.kind}`];
  if (badge.is_head) {
    parts.push("ref-head");
  }
  return parts.join(" ");
}

export interface GraphRowProps {
  oid: string;
  commit?: CommitSummaryDto;
  layout: RowLayoutDto;
  laneCount: number;
  start: number;
  height: number;
  selected: boolean;
  located: boolean;
  onRowClick: (event: MouseEvent) => void;
  onRowContextMenu: (event: MouseEvent) => void;
  onRowMouseEnter: (event: MouseEvent) => void;
  onRowMouseLeave: () => void;
}

export function GraphRow({
  oid,
  commit,
  layout,
  laneCount,
  start,
  height,
  selected,
  located,
  onRowClick,
  onRowContextMenu,
  onRowMouseEnter,
  onRowMouseLeave,
}: GraphRowProps) {
  const classes = ["graph-row"];
  if (selected) {
    classes.push("selected");
  }
  if (located) {
    classes.push("located");
  }
  return (
    <div
      className={classes.join(" ")}
      style={{ transform: `translateY(${start}px)`, height }}
      onClick={onRowClick}
      onContextMenu={onRowContextMenu}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
    >
      <GraphCell layout={layout} laneCount={laneCount} height={height} />
      <div className="graph-row-summary">
        <span className="commit-summary">{commit?.summary || "（无提交说明）"}</span>
        {commit?.refs.map((badge) => (
          <span className="ref-group" key={`${badge.kind}:${badge.name}`}>
            <span className={badgeClass(badge)}>
              {badge.is_head ? "HEAD → " : ""}
              {badge.name}
            </span>
            {badge.description && <span className="ref-desc">{badge.description}</span>}
          </span>
        ))}
      </div>
      <span className="graph-row-author">{commit?.author_name ?? "—"}</span>
      <span className="graph-row-date">{formatDate(commit?.authored_at ?? 0)}</span>
      <span className="graph-row-oid mono">{commit?.short_oid ?? oid.slice(0, 7)}</span>
    </div>
  );
}
