import { memo } from "react";
import { useI18n } from "../../i18n";
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
  /** 批量选择序号（0 起始）；未选中为 -1。 */
  selectionIndex: number;
  located: boolean;
}

/**
 * 图谱行：点击、右键、悬浮等行交互已委托到 GraphList 容器（按 data-oid 反查），
 * props 只剩纯数据，且引用在追加页时保持稳定（旧行对象复用，见 model.ts），
 * 因此 memo 默认浅比较即可阻断 toast、悬浮卡等无关状态引发的全行重渲染。
 */
export const GraphRow = memo(function GraphRow({
  oid,
  commit,
  layout,
  laneCount,
  start,
  height,
  selected,
  selectionIndex,
  located,
}: GraphRowProps) {
  const { t } = useI18n();
  const classes = ["graph-row"];
  if (selected || selectionIndex >= 0) {
    classes.push("selected");
  }
  if (selectionIndex >= 0) {
    classes.push("batch-selected");
  }
  if (located) {
    classes.push("located");
  }
  return (
    <div
      className={classes.join(" ")}
      data-oid={oid}
      style={{ transform: `translateY(${start}px)`, height }}
    >
      <GraphCell layout={layout} laneCount={laneCount} height={height} />
      <div className="graph-row-summary">
        {selectionIndex >= 0 && (
          <span className="graph-row-selection mono">{selectionIndex + 1}</span>
        )}
        <span className="commit-summary">{commit?.summary || t("graph.noSummary")}</span>
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
});
