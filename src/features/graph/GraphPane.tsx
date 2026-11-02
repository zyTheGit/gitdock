import type { MouseEvent } from "react";
import type { CommitSummaryDto, RepoStateDto, GraphScope } from "../../shared/types";
import { Select } from "../../shared/Select";
import { GraphList } from "./GraphList";
import type { GraphLoader } from "./useGraph";

interface GraphPaneProps {
  repo: RepoStateDto;
  scope: GraphScope;
  onScopeChange: (scope: GraphScope) => void;
  graph: GraphLoader;
  selectedOid: string | null;
  focusedOid?: string | null;
  focusSeq?: number | null;
  onSelect: (oid: string) => void;
  onCtrlSelect?: (commit: CommitSummaryDto) => void;
  onContextMenu?: (event: MouseEvent, commit: CommitSummaryDto) => void;
}

export function GraphPane({
  repo,
  scope,
  onScopeChange,
  graph,
  selectedOid,
  focusedOid,
  focusSeq,
  onSelect,
  onCtrlSelect,
  onContextMenu,
}: GraphPaneProps) {
  const localBranches = repo.refs.filter((ref) => ref.kind === "local_branch");
  const { view, loading, loadingMore, error } = graph;

  return (
    <section className="graph-pane">
      <div className="graph-toolbar">
        <div className="scope-tabs">
          <button
            className={scope.kind === "head" ? "active" : ""}
            onClick={() => onScopeChange({ kind: "head" })}
          >
            当前分支相关
          </button>
          <button
            className={scope.kind === "all" ? "active" : ""}
            onClick={() => onScopeChange({ kind: "all" })}
          >
            全量
          </button>
        </div>

        <Select
          className="branch-filter"
          compact
          aria-label="按本地分支过滤图谱"
          value={scope.kind === "branch" ? scope.value : ""}
          options={[
            { value: "", label: "分支过滤…" },
            ...localBranches.map((ref) => ({ value: ref.short_name, label: ref.short_name })),
          ]}
          onChange={(event) => {
            const value = event.target.value;
            onScopeChange(value ? { kind: "branch", value } : { kind: "head" });
          }}
        />

        <span className="graph-view-label">{view.viewLabel || "—"}</span>
        <span className="graph-count muted">
          {view.rows.length} 条{view.hasMore ? " · 可继续加载" : " · 已全部加载"}
          {view.generation ? ` · generation ${view.generation}` : ""}
        </span>
      </div>

      {error && <div className="banner danger">{error}</div>}

      <div className="graph-scroll">
        <GraphList
          view={view}
          loading={loading}
          loadingMore={loadingMore}
          selectedOid={selectedOid}
          focusedOid={focusedOid}
          focusSeq={focusSeq}
          onSelect={onSelect}
          onCtrlSelect={onCtrlSelect}
          onContextMenu={onContextMenu}
          onLoadMore={() => void graph.loadMore()}
        />
      </div>
    </section>
  );
}
