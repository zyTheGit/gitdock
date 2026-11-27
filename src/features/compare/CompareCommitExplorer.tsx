import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto, FileDiffDto } from "../../shared/types";
import { useCommitDetail, useFileDiff } from "../detail/useCommitDetail";
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
  onLocateCommit: (oid: string) => void;
  onCommitContextMenu: (event: MouseEvent, commit: CommitSummaryDto) => void;
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
  onLocateCommit,
  onCommitContextMenu,
}: CompareCommitExplorerProps) {
  const { t } = useI18n();
  const [hideEquivalent, setHideEquivalent] = useState(false);
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

  const [selectedOid, setSelectedOid] = useState<string | null>(
    () => visibleCompare[0]?.oid ?? visibleBase[0]?.oid ?? null,
  );

  useEffect(() => {
    setHideEquivalent(false);
    setCompareCollapsed(compareCommits.length === 0 && baseCommits.length > 0);
    setBaseCollapsed(baseCommits.length === 0 && compareCommits.length > 0);
  }, [compareKey, compareCommits.length, baseCommits.length]);

  useEffect(() => {
    setSelectedOid((current) => {
      if (current && flatEntries.some((entry) => entry.commit.oid === current)) {
        return current;
      }
      return flatEntries[0]?.commit.oid ?? null;
    });
  }, [flatEntries]);

  const selectedEntry = useMemo(
    () => flatEntries.find((entry) => entry.commit.oid === selectedOid) ?? null,
    [flatEntries, selectedOid],
  );

  const detail = useCommitDetail(selectedOid, repoGeneration);
  const files = detail.data?.files ?? [];
  const [filePath, setFilePath] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState(false);
  const [lastDiff, setLastDiff] = useState<FileDiffDto | null>(null);
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
  }, [selectedOid]);

  const shownDiff = fileDiff.data ?? (expandedDiff ? lastDiff : null);

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
              return (
                <li key={commit.oid}>
                  <button
                    type="button"
                    className={[
                      "commit-explorer-item",
                      active ? "active" : "",
                      eqOid ? "equivalent" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedOid(commit.oid)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onCommitContextMenu(event, commit);
                    }}
                    title={commit.oid}
                  >
                    <div className="commit-explorer-row-top">
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
        {equivalentCount > 0 && (
          <div className="commit-explorer-toolbar">
            <label className="commit-eq-filter">
              <input
                type="checkbox"
                checked={hideEquivalent}
                onChange={(event) => setHideEquivalent(event.target.checked)}
              />
              <span>{t("compare.hideEquivalent", { n: equivalentCount })}</span>
            </label>
          </div>
        )}
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
                    onContextMenu={() => undefined}
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
    </div>
  );
}
