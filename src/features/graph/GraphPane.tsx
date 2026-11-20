import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import type { CommitSummaryDto, PullMode, RepoStateDto, GraphScope } from "../../shared/types";
import type { RemoteActions } from "../../app/useRemoteActions";
import type { ScrollRestore } from "../../app/useRepoTabState";
import { FetchPruneDialog } from "../repository/FetchPruneDialog";
import { PushUpstreamDialog } from "../repository/PushUpstreamDialog";
import { Select } from "../../shared/Select";
import { GraphList } from "./GraphList";
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
  remote: RemoteActions;
  /** 打开 Reflog 恢复视图（只读弹窗，ADR-0029）；入口放在图谱工具栏。 */
  onOpenReflog: () => void;
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

        <Select
          className="branch-filter"
          compact
          aria-label={t("graph.branchFilterAria")}
          value={scope.kind === "branch" ? scope.value : ""}
          options={[{ value: "", label: t("graph.branchFilterPlaceholder") }]}
          groups={[
            { label: t("shell.localBranches"), options: localBranches },
            { label: t("shell.remoteBranches"), options: remoteBranches },
            { label: t("repository.tags"), options: tags },
          ]
            .filter((group) => group.options.length > 0)
            .map((group) => ({
              label: group.label,
              // 后端 GraphScope::Branch 依次解析 refs/heads、refs/remotes、refs/tags。
              options: group.options.map((ref) => ({
                value: ref.short_name,
                label: ref.short_name,
              })),
            }))}
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
        </span>
        <button className="graph-recovery" title={t("graph.reflogOpenTitle")} onClick={onOpenReflog}>
          <Icon name="restore" />
          <span>{t("graph.reflogOpen")}</span>
        </button>
        <div className="remote-actions">
          <button
            disabled={remote.disabled || remote.busy !== null}
            title={t("graph.fetchTitle")}
            onClick={() => remote.run("fetch")}
          >
            <Icon name="cloudDownload" />
            <span>{remote.busy === "fetch" ? t("graph.fetching") : t("graph.fetch")}</span>
          </button>
          <button
            disabled={remote.disabled || remote.busy !== null}
            title={t("graph.fetchPruneTitle")}
            onClick={() => setPruneOpen(true)}
          >
            <Icon name="refresh" />
            <span>{t("graph.fetchPrune")}</span>
          </button>
          <Select
            className="pull-mode"
            compact
            aria-label={t("graph.pullModeAria")}
            value={remote.pullMode}
            options={[
              { value: "ff_only", label: t("graph.pullModeFfOnly") },
              { value: "merge", label: t("graph.pullModeMerge") },
            ]}
            onChange={(event) => remote.setPullMode(event.target.value as PullMode)}
          />
          <button
            disabled={remote.disabled || remote.busy !== null}
            title={t("graph.pullTitle")}
            onClick={() => remote.run("pull")}
          >
            <Icon name="download" />
            <span>{remote.busy === "pull" ? t("graph.pulling") : t("graph.pull")}</span>
          </button>
          <button
            disabled={remote.disabled || remote.busy !== null}
            title={t("graph.pushTitle")}
            onClick={() => remote.run("push")}
          >
            <Icon name="upload" />
            <span>{remote.busy === "push" ? t("graph.pushing") : t("graph.push")}</span>
          </button>
        </div>
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