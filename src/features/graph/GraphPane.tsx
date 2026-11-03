import type { MouseEvent } from "react";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
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
            {t("graph.scopeHead")}
          </button>
          <button
            className={scope.kind === "all" ? "active" : ""}
            onClick={() => onScopeChange({ kind: "all" })}
          >
            {t("graph.scopeAll")}
          </button>
        </div>

        <Select
          className="branch-filter"
          compact
          aria-label={t("graph.branchFilterAria")}
          value={scope.kind === "branch" ? scope.value : ""}
          options={[
            { value: "", label: t("graph.branchFilterPlaceholder") },
            ...localBranches.map((ref) => ({ value: ref.short_name, label: ref.short_name })),
          ]}
          onChange={(event) => {
            const value = event.target.value;
            onScopeChange(value ? { kind: "branch", value } : { kind: "head" });
          }}
        />

        <span className="graph-view-label">
          {view.scope
            ? view.scope.kind === "branch"
              ? t("graph.scopeBranch", { branch: view.scope.value })
              : view.scope.kind === "all"
                ? t("graph.scopeAll")
                : t("graph.scopeHead")
            : "—"}
        </span>
        <span className="graph-count muted">
          {view.hasMore
            ? t("graph.rowCountMore", { n: view.rows.length })
            : t("graph.rowCountAll", { n: view.rows.length })}
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
