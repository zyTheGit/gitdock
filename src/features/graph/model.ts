import type {
  CommitSummaryDto,
  GraphPageDto,
  ResolvedEdgeDto,
  RowLayoutDto,
} from "../../shared/types";

export interface GraphRow {
  layout: RowLayoutDto;
  commit?: CommitSummaryDto;
}

export interface GraphView {
  viewKey: string;
  viewLabel: string;
  generation: number;
  rows: GraphRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const EMPTY_GRAPH_VIEW: GraphView = {
  viewKey: "",
  viewLabel: "",
  generation: 0,
  rows: [],
  nextCursor: null,
  hasMore: false,
};

function pairRows(page: GraphPageDto): GraphRow[] {
  const commits = new Map(page.commits.map((commit) => [commit.oid, commit]));
  return page.layout.map((layout) => ({ layout, commit: commits.get(layout.oid) }));
}

/** 跨页父边解析后，已渲染行的 pending 标记必须原位清除。 */
export function applyResolvedEdges(rows: GraphRow[], resolved: ResolvedEdgeDto[]): GraphRow[] {
  if (resolved.length === 0) {
    return rows;
  }
  const next = rows.slice();
  for (const edge of resolved) {
    const row = next[edge.row];
    if (!row) {
      continue;
    }
    const index = row.layout.parents.findIndex((parent) => parent.parent === edge.parent);
    if (index < 0 || !row.layout.parents[index].pending) {
      continue;
    }
    const parents = row.layout.parents.slice();
    parents[index] = { ...parents[index], lane: edge.lane, pending: false };
    next[edge.row] = { ...row, layout: { ...row.layout, parents } };
  }
  return next;
}

export function startView(page: GraphPageDto): GraphView {
  return {
    viewKey: page.view_key,
    viewLabel: page.view_label,
    generation: page.generation,
    rows: pairRows(page),
    nextCursor: page.next_cursor ?? null,
    hasMore: page.has_more,
  };
}

/**
 * 只接受同一 view_key 与 generation 的后续页；否则丢弃，避免旧遍历结果覆盖新 UI。
 */
export function appendPage(view: GraphView, page: GraphPageDto): GraphView | null {
  if (view.viewKey !== page.view_key || view.generation !== page.generation) {
    return null;
  }
  return {
    ...view,
    rows: applyResolvedEdges(view.rows, page.resolved_edges).concat(pairRows(page)),
    nextCursor: page.next_cursor ?? null,
    hasMore: page.has_more,
  };
}
