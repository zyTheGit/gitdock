import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import type { CommitSummaryDto, RepoStateDto, GraphScope } from "../../shared/types";
import type { RemoteActions as RemoteActionsState } from "../../app/useRemoteActions";
import type { ScrollRestore } from "../../app/useRepoTabState";
import { FetchPruneDialog } from "../repository/FetchPruneDialog";
import { PushUpstreamDialog } from "../repository/PushUpstreamDialog";
import { BranchFilterPicker } from "./BranchFilterPicker";
import { GraphList } from "./GraphList";
import { RemoteActions } from "./RemoteActions";
import { useCommitSelection } from "./useCommitSelection";
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
  onContextMenu?: (
    event: MouseEvent,
    commit: CommitSummaryDto,
    selectedCommits: CommitSummaryDto[],
  ) => void;
  remote: RemoteActionsState;
  /** 打开 Reflog 恢复视图（只读弹窗，ADR-0029）；入口放在图谱工具栏。 */
  onOpenReflog: () => void;
  /** 写操作是否全局禁用（忙碌/中断态/bare/不支持的 Git 版本）。 */
  writeDisabled?: boolean;
  onBatchCherryPick?: (commits: CommitSummaryDto[]) => void;
  onBatchRevert?: (commits: CommitSummaryDto[]) => void;
  onCompareCommits?: (base: CommitSummaryDto, compare: CommitSummaryDto) => void;
  /** 写操作成功后刷新仓库快照与图谱（与 App 的 stagingMutated 一致）。 */
  onMutated: (message: string) => Promise<void>;
  /** 标签切换的滚动恢复与偏移上报（ADR-0032）；由 useRepoTabState 提供。 */
  scrollRestore?: ScrollRestore;
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
  remote,
  onOpenReflog,
  writeDisabled = false,
  onBatchCherryPick,
  onBatchRevert,
  onCompareCommits,
  onMutated,
  scrollRestore,
}: GraphPaneProps) {
  const { t } = useI18n();
  const [pruneOpen, setPruneOpen] = useState(false);
  const localBranches = repo.refs.filter((ref) => ref.kind === "local_branch");
  const remoteBranches = repo.refs.filter((ref) => ref.kind === "remote_branch");
  const tags = repo.refs.filter((ref) => ref.kind === "tag");
  const { view, loading, loadingMore, error } = graph;

  // 选择顺序按当前视图行序：锚点在前、Shift 点击的目标在后。
  const orderedOids = useMemo(
    () => view.rows.map((row) => row.commit?.oid ?? row.layout.oid),
    [view.rows],
  );
  const selection = useCommitSelection(orderedOids);
  const clearSelection = selection.clear;
  const selectedCommits = useMemo(() => {
    if (selection.oids.length < 2) {
      return [];
    }
    const byOid = new Map(
      view.rows.flatMap((row) => (row.commit ? [[row.commit.oid, row.commit] as const] : [])),
    );
    return selection.oids
      .map((oid) => byOid.get(oid))
      .filter((commit): commit is CommitSummaryDto => commit !== undefined);
  }, [selection.oids, view.rows]);

  useEffect(() => {

    clearSelection();
  }, [view.viewKey, clearSelection]);

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

        <BranchFilterPicker
          scope={scope}
          localBranches={localBranches}
          remoteBranches={remoteBranches}
          tags={tags}
          onScopeChange={onScopeChange}
        />

        <span className="graph-count muted">
          {view.hasMore
            ? t("graph.rowCountMore", { n: view.rows.length })
            : t("graph.rowCountAll", { n: view.rows.length })}
        </span>
        <button
          className="graph-recovery"
          title={t("graph.reflogOpenTitle")}
          aria-label={t("graph.reflogOpen")}
          onClick={onOpenReflog}
        >
          <Icon name="restore" />
        </button>
        <RemoteActions
          remote={remote}
          disabled={pruneOpen || remote.upstream !== null}
          onFetchPrune={() => setPruneOpen(true)}
        />
      </div>

      {error && <div className="banner danger">{error}</div>}
      {remote.error && (
        <div className="banner danger" role="alert">
          <span className="banner-text">{remote.error}</span>
          <div className="banner-actions">
            <button className="link" onClick={remote.clearError}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {selectedCommits.length >= 2 && (
        <div className="graph-batch-bar" role="region" aria-label={t("graph.batchBarAria")}>
          <span className="graph-batch-count">
            {t("graph.batchSelectedCount", { n: selectedCommits.length })}
          </span>
          <div className="graph-batch-actions">
            {selectedCommits.length === 2 && onCompareCommits && (
              <button
                type="button"
                onClick={() => onCompareCommits(selectedCommits[0], selectedCommits[1])}
              >
                {t("graph.batchCompareTwo")}
              </button>
            )}
            {onBatchCherryPick && (
              <button
                type="button"
                disabled={writeDisabled}
                onClick={() => onBatchCherryPick(selectedCommits)}
              >
                {t("graph.menuBatchCherryPick", { n: selectedCommits.length })}
              </button>
            )}
            {onBatchRevert && (
              <button
                type="button"
                disabled={writeDisabled}
                onClick={() => onBatchRevert(selectedCommits)}
              >
                {t("graph.menuBatchRevert", { n: selectedCommits.length })}
              </button>
            )}
            <button type="button" className="link" onClick={clearSelection}>
              {t("graph.batchClear")}
            </button>
          </div>
        </div>
      )}

      <div className="graph-scroll">
        <GraphList
          view={view}
          loading={loading}
          loadingMore={loadingMore}
          selectedOid={selectedOid}
          selectedOids={selection.oids}
          focusedOid={focusedOid}
          focusSeq={focusSeq}
          scrollRestore={
            scrollRestore
              ? {
                  top: scrollRestore.top,
                  ownerPath: repo.path,
                  loadedPath: graph.loadedRepo,
                  onConsumed: scrollRestore.onConsumed,
                }
              : null
          }
          onScrollTop={scrollRestore?.onScroll}
          onSelect={(oid) => {
            clearSelection();
            selection.setAnchor(oid);
            onSelect(oid);
          }}
          onRangeSelect={selection.selectRange}
          onToggleSelect={selection.toggle}
          onCtrlSelect={onCtrlSelect}
          onContextMenu={onContextMenu}
          selectionIndexOf={selection.indexOf}
          onLoadMore={() => void graph.loadMore()}
        />
      </div>

      {pruneOpen && (
        <FetchPruneDialog onCancel={() => setPruneOpen(false)} onMutated={onMutated} />
      )}
      {remote.upstream && (
        <PushUpstreamDialog
          branch={remote.upstream.branch}
          remotes={remote.upstream.remotes}
          onCancel={remote.closeUpstream}
          onMutated={onMutated}
        />
      )}
    </section>
  );
}