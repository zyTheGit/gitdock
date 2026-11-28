import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { consumeEsc, isEscConsumed } from "../../shared/esc";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto, ExternalToolConfig, FileDiffDto } from "../../shared/types";
import { useCommitDetail, useFileDiff } from "../detail/useCommitDetail";
import { useCommitSelection } from "../graph/useCommitSelection";
import { fileHistoryMenuItems } from "../history/menuItems";
import { CompareCommitBatchBar } from "./CompareCommitBatchBar";
import { CompareDiffPane } from "./CompareDiffPane";
import { CompareFileList } from "./CompareFileList";

interface CompareCommitExplorerProps {
  repoGeneration: number;
  compareKey: string;
  baseLabel: string;
  compareLabel: string;
  compareCommits: CommitSummaryDto[];
  compareTruncated: boolean;
  baseCommits: CommitSummaryDto[];
  baseTruncated: boolean;
  equivalentMap?: Record<string, string>;
  tools: ExternalToolConfig[];
  writeDisabled?: boolean;
  onCherryPick?: (commit: CommitSummaryDto) => void;
  onRevert?: (commit: CommitSummaryDto) => void;
  onBatchCherryPick?: (commits: CommitSummaryDto[]) => void;
  onBatchRevert?: (commits: CommitSummaryDto[]) => void;
  onExternalFileDiff: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
  ) => void;
  onLocateCommit: (oid: string) => void;
  onCommitContextMenu: (
    event: MouseEvent,
    commit: CommitSummaryDto,
    selection: CommitSummaryDto[],
  ) => void;
}

interface CommitEntry {
  side: "compare" | "base";
  commit: CommitSummaryDto;
  equivalentOid?: string;
}

export function CompareCommitExplorer({
  repoGeneration,
  compareKey,
  baseLabel,
  compareLabel,
  compareCommits,
  compareTruncated,
  baseCommits,
  baseTruncated,
  equivalentMap,
  tools,
  writeDisabled = false,
  onCherryPick,
  onRevert,
  onBatchCherryPick,
  onBatchRevert,
  onExternalFileDiff,
  onLocateCommit,
  onCommitContextMenu,
}: CompareCommitExplorerProps) {
  const { t } = useI18n();
  const [hideEquivalent, setHideEquivalent] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [compareCollapsed, setCompareCollapsed] = useState(
    () => compareCommits.length === 0 && baseCommits.length > 0,
  );
  const [baseCollapsed, setBaseCollapsed] = useState(
    () => baseCommits.length === 0 && compareCommits.length > 0,
  );

  const equivalentCount = useMemo(() => {
    if (!equivalentMap) {
      return 0;
    }
    let count = 0;
    for (const c of compareCommits) {
      if (equivalentMap[c.oid]) {
        count += 1;
      }
    }
    for (const c of baseCommits) {
      if (equivalentMap[c.oid]) {
        count += 1;
      }
    }
    return count;
  }, [compareCommits, baseCommits, equivalentMap]);

  const visibleCompare = useMemo(
    () =>
      compareCommits.filter((c) => !hideEquivalent || !equivalentMap?.[c.oid]),
    [compareCommits, hideEquivalent, equivalentMap],
  );
  const visibleBase = useMemo(
    () => baseCommits.filter((c) => !hideEquivalent || !equivalentMap?.[c.oid]),
    [baseCommits, hideEquivalent, equivalentMap],
  );

  const flatEntries = useMemo<CommitEntry[]>(() => {
    const list: CommitEntry[] = [];
    if (!compareCollapsed) {
      for (const commit of visibleCompare) {
        list.push({ side: "compare", commit, equivalentOid: equivalentMap?.[commit.oid] });
      }
    }
    if (!baseCollapsed) {
      for (const commit of visibleBase) {
        list.push({ side: "base", commit, equivalentOid: equivalentMap?.[commit.oid] });
      }
    }
    return list;
  }, [visibleCompare, visibleBase, compareCollapsed, baseCollapsed, equivalentMap]);

  const flatOids = useMemo(
    () => flatEntries.map((entry) => entry.commit.oid),
    [flatEntries],
  );
  const selection = useCommitSelection(flatOids);
  const clearSelection = selection.clear;
  const setSelectionAnchor = selection.setAnchor;

  const selectedCommits = useMemo(() => {
    if (selection.oids.length === 0) {
      return [];
    }
    const byOid = new Map<string, CommitSummaryDto>();
    for (const commit of compareCommits) {
      byOid.set(commit.oid, commit);
    }
    for (const commit of baseCommits) {
      byOid.set(commit.oid, commit);
    }
    return selection.oids
      .map((oid) => byOid.get(oid))
      .filter((commit): commit is CommitSummaryDto => commit !== undefined);
  }, [selection.oids, compareCommits, baseCommits]);

  const [selectedOid, setSelectedOid] = useState<string | null>(
    () => visibleCompare[0]?.oid ?? visibleBase[0]?.oid ?? null,
  );

  useEffect(() => {
    setHideEquivalent(false);
    setCompareCollapsed(compareCommits.length === 0 && baseCommits.length > 0);
    setBaseCollapsed(baseCommits.length === 0 && compareCommits.length > 0);
  }, [compareKey, compareCommits.length, baseCommits.length]);

  useEffect(() => {
    clearSelection();
    setBatchMode(false);
  }, [compareKey, repoGeneration, clearSelection]);

  useEffect(() => {
    setSelectedOid((current) => {
      if (current && flatEntries.some((entry) => entry.commit.oid === current)) {
        return current;
      }
      return flatEntries[0]?.commit.oid ?? null;
    });
  }, [flatEntries]);

  useEffect(() => {
    if (selectedOid && selection.oids.length === 0) {
      setSelectionAnchor(selectedOid);
    }
  }, [selectedOid, selection.oids.length, setSelectionAnchor]);

  const selectedEntry = useMemo(
    () => flatEntries.find((entry) => entry.commit.oid === selectedOid) ?? null,
    [flatEntries, selectedOid],
  );

  const detail = useCommitDetail(selectedOid, repoGeneration);
  const files = detail.data?.files ?? [];
  const [filePath, setFilePath] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState(false);
  const [lastDiff, setLastDiff] = useState<FileDiffDto | null>(null);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const fileDiff = useFileDiff(selectedOid, filePath, repoGeneration);

  useEffect(() => {
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [files]);

  useEffect(() => {
    if (fileDiff.data) {
      setLastDiff(fileDiff.data);
    }
  }, [fileDiff.data]);

  useEffect(() => {
    setExpandedDiff(false);
    setFileMenu(null);
  }, [selectedOid]);

  const shownDiff = fileDiff.data ?? (expandedDiff ? lastDiff : null);
  const fileMenuItems: MenuItem[] =
    fileMenu && selectedEntry && detail.data
      ? [
          ...fileHistoryMenuItems(fileMenu.path, selectedEntry.commit.oid, "commit"),
          ...(tools.length === 0
            ? [
                {
                  label: t("compare.noExternalTool"),
                  disabled: true,
                  dividerBefore: true,
                  onSelect: () => undefined,
                },
              ]
            : tools.map((tool, index) => ({
                label: t("compare.openWithTool", { name: tool.name }),
                dividerBefore: index === 0,
                onSelect: () =>
                  onExternalFileDiff(
                    index,
                    detail.data?.parents[0] ?? null,
                    selectedEntry.commit.oid,
                    fileMenu.path,
                  ),
              }))),
        ]
      : [];

  const exitBatchMode = () => {
    clearSelection();
    setBatchMode(false);
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !isEscConsumed(event.nativeEvent)) {
      if (batchMode || selection.oids.length > 0) {
        consumeEsc(event.nativeEvent);
        exitBatchMode();
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    if (flatEntries.length === 0) {
      return;
    }
    event.preventDefault();
    const index = flatEntries.findIndex((entry) => entry.commit.oid === selectedOid);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index < 0 ? 0 : Math.min(flatEntries.length - 1, Math.max(0, index + delta));
    const target = flatEntries[next];
    if (target) {
      setSelectedOid(target.commit.oid);
    }
  };

  const handleCommitMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      return;
    }
    if ((event.target as Element).closest("[data-select-toggle]")) {
      event.preventDefault();
    }
  };

  const handleCommitClick = (event: MouseEvent<HTMLButtonElement>, oid: string) => {
    const toggleHit = (event.target as Element).closest("[data-select-toggle]");
    if (toggleHit) {
      event.preventDefault();
      if (event.shiftKey) {
        window.getSelection()?.removeAllRanges();
        selection.selectRange(oid);
      } else {
        selection.toggle(oid, { includeAnchor: false });
      }
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      selection.selectRange(oid);
      return;
    }
    if (event.altKey) {
      event.preventDefault();
      selection.toggle(oid, { includeAnchor: true });
      return;
    }
    if (batchMode) {
      event.preventDefault();
      selection.toggle(oid, { includeAnchor: false });
      return;
    }
    clearSelection();
    setSelectionAnchor(oid);
    setSelectedOid(oid);
  };

  const renderGroup = (
    side: "compare" | "base",
    label: string,
    commits: CommitSummaryDto[],
    truncated: boolean,
    collapsed: boolean,
    onToggle: () => void,
  ) => (
    <section className={`commit-explorer-group side-${side}`}>
      <button
        type="button"
        className="commit-explorer-group-head"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <Icon name="chevronDown" className="commit-explorer-chevron" />
        <span className="commit-explorer-group-title" title={label}>
          {t("compare.commitGroupOnly", { name: label })}
        </span>
        <span className="commit-explorer-group-count">
          {truncated ? `${commits.length}+` : commits.length}
        </span>
      </button>
      {!collapsed &&
        (commits.length === 0 ? (
          <p className="commit-explorer-empty muted">{t("compare.commitGroupEmpty")}</p>
        ) : (
          <ul className="commit-explorer-list">
            {commits.map((commit) => {
              const eqOid = equivalentMap?.[commit.oid];
              const active = commit.oid === selectedOid;
              const selectionIndex = selection.indexOf(commit.oid);
              const batchSelected = selectionIndex >= 0;
              return (
                <li key={commit.oid}>
                  <button
                    type="button"
                    className={[
                      "commit-explorer-item",
                      active && selection.oids.length === 0 ? "active" : "",
                      batchSelected ? "batch-selected" : "",
                      eqOid ? "equivalent" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={handleCommitMouseDown}
                    onClick={(event) => handleCommitClick(event, commit.oid)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onCommitContextMenu(event, commit, selectedCommits);
                    }}
                    title={commit.oid}
                  >
                    <div className="commit-explorer-row-top">
                      <span
                        className={[
                          "commit-explorer-check",
                          batchSelected ? "is-selected mono" : "",
                          batchMode || selection.oids.length > 0 ? "is-visible" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-select-toggle={commit.oid}
                        role="checkbox"
                        aria-checked={batchSelected}
                        aria-label={t("graph.toggleSelectCommitAria")}
                        title={t("graph.toggleSelectCommitTitle")}
                      >
                        {batchSelected ? selectionIndex + 1 : ""}
                      </span>
                      <span className="commit-explorer-summary">
                        {commit.summary || t("graph.noSummary")}
                      </span>
                      {eqOid && (
                        <span
                          className="commit-eq-badge"
                          title={t("compare.equivalentHint", { oid: eqOid.slice(0, 8) })}
                        >
                          =
                        </span>
                      )}
                    </div>
                    <div className="commit-explorer-row-meta muted">
                      <span className="commit-explorer-author">{commit.author_name}</span>
                      <span>{formatDate(commit.authored_at)}</span>
                      <span className="mono">{commit.short_oid}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );

  return (
    <div className="commit-explorer">
      <div
        className="commit-explorer-side"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        aria-label={t("compare.commitExplorerAria")}
      >
        {(equivalentCount > 0 || compareCommits.length + baseCommits.length > 0) && (
          <div className="commit-explorer-toolbar">
            {equivalentCount > 0 ? (
              <label className="commit-eq-filter">
                <input
                  type="checkbox"
                  checked={hideEquivalent}
                  onChange={(event) => setHideEquivalent(event.target.checked)}
                />
                <span>{t("compare.hideEquivalent", { n: equivalentCount })}</span>
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              className={batchMode ? "graph-batch-toggle active" : "graph-batch-toggle"}
              aria-pressed={batchMode}
              title={t("graph.batchModeToggleTitle")}
              onClick={() => {
                if (batchMode) {
                  exitBatchMode();
                } else {
                  setBatchMode(true);
                }
              }}
            >
              {t("graph.batchModeToggle")}
            </button>
          </div>
        )}
        <CompareCommitBatchBar
          selectedCommits={selectedCommits}
          batchMode={batchMode}
          writeDisabled={writeDisabled}
          onCherryPick={onCherryPick}
          onRevert={onRevert}
          onBatchCherryPick={onBatchCherryPick}
          onBatchRevert={onBatchRevert}
          onClear={clearSelection}
          onExitBatchMode={exitBatchMode}
        />
        <div className="commit-explorer-groups">
          {renderGroup(
            "compare",
            compareLabel,
            visibleCompare,
            compareTruncated,
            compareCollapsed,
            () => setCompareCollapsed((v) => !v),
          )}
          {renderGroup("base", baseLabel, visibleBase, baseTruncated, baseCollapsed, () =>
            setBaseCollapsed((v) => !v),
          )}
        </div>
      </div>

      <div className="commit-explorer-detail">
        {!selectedEntry ? (
          <p className="muted commit-explorer-placeholder">{t("compare.selectCommitHint")}</p>
        ) : (
          <>
            <div className="commit-explorer-detail-head">
              <div className="commit-explorer-detail-info">
                <span className={`commit-side-pill side-${selectedEntry.side}`}>
                  {selectedEntry.side === "compare" ? compareLabel : baseLabel}
                </span>
                <strong className="commit-explorer-detail-title">
                  {selectedEntry.commit.summary || t("graph.noSummary")}
                </strong>
                <span className="mono muted">{selectedEntry.commit.short_oid}</span>
                <span className="muted">
                  {selectedEntry.commit.author_name} ·{" "}
                  {formatDate(selectedEntry.commit.authored_at)}
                </span>
                {selectedEntry.equivalentOid && (
                  <span
                    className="commit-eq-badge"
                    title={t("compare.equivalentHint", {
                      oid: selectedEntry.equivalentOid.slice(0, 8),
                    })}
                  >
                    {t("compare.equivalentTag", {
                      oid: selectedEntry.equivalentOid.slice(0, 8),
                    })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onLocateCommit(selectedEntry.commit.oid)}
              >
                {t("compare.locateInGraph")}
              </button>
            </div>

            {detail.loading && <p className="muted">{t("compare.loadingCommitDetail")}</p>}
            {detail.error && <div className="banner danger">{detail.error}</div>}
            {detail.data && (
              <div className="detail-columns compare-columns commit-explorer-columns">
                <div className="commit-explorer-files">
                  <CompareFileList
                    files={files}
                    activePath={filePath}
                    twoDot={false}
                    baseLabel={baseLabel}
                    compareLabel={compareLabel}
                    onSelect={setFilePath}
                    onContextMenu={(event, path) => {
                      setFilePath(path);
                      setFileMenu({ x: event.clientX, y: event.clientY, path });
                    }}
                  />
                </div>
                <CompareDiffPane
                  diffKey={`commit:${selectedEntry.commit.oid}`}
                  diff={shownDiff}
                  loading={fileDiff.loading}
                  error={fileDiff.error}
                  files={files}
                  activePath={filePath}
                  onSelectFile={setFilePath}
                  onFileContextMenu={(event, path) => {
                    setFilePath(path);
                    setFileMenu({ x: event.clientX, y: event.clientY, path });
                  }}
                  expanded={expandedDiff}
                  onExpandedChange={setExpandedDiff}
                  sideLabels={{
                    left:
                      detail.data.parents.length === 0
                        ? t("diff.sideEmpty")
                        : detail.data.baseline === "merge_first_parent"
                          ? t("diff.sideFirstParent", {
                              oid: detail.data.parents[0].slice(0, 7),
                            })
                          : t("diff.sideParent", {
                              oid: detail.data.parents[0].slice(0, 7),
                            }),
                    right: t("diff.sideBranchCommit", {
                      branch:
                        selectedEntry.side === "compare" ? compareLabel : baseLabel,
                      oid: selectedEntry.commit.short_oid,
                    }),
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
      {fileMenu && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          items={fileMenuItems}
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  );
}
