import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { warningText } from "../../shared/error";
import type { CommitSummaryDto, ExternalToolConfig, FileDiffDto } from "../../shared/types";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { Select } from "../../shared/Select";
import { fileHistoryMenuItems } from "../history/menuItems";
import { CompareCommitExplorer } from "./CompareCommitExplorer";
import { CompareDiffPane } from "./CompareDiffPane";
import { CompareFileList } from "./CompareFileList";
import { CompareHeader } from "./CompareHeader";
import {
  CompareStatusFilter,
  matchesStatusBucket,
  type CompareStatusFilterValue,
} from "./CompareStatusFilter";
import type { CompareLoader, CompareSlot } from "./useCompare";
import { isWorktreeSlot, useCompareFileDiff } from "./useCompare";

interface CompareViewProps {
  repoGeneration: number;
  base: CompareSlot;
  compare: CompareSlot;
  loader: CompareLoader;
  pathFilter: string;
  onPathFilterChange: (value: string) => void;
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  tools: ExternalToolConfig[];
  defaultTool?: string | null;
  commitMenu: (commit: CommitSummaryDto) => MenuItem[];
  onLocateCommit: (oid: string) => void;
  onSwap: () => void;
  onExternalDiff: (toolIndex: number, path: string) => void;
  onExternalCommitFileDiff: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
  ) => void;
  onDirectoryDiff: (toolIndex: number) => void;
  onBack: () => void;
}

export function CompareView({
  repoGeneration,
  base,
  compare,
  loader,
  pathFilter,
  onPathFilterChange,
  twoDot,
  onTwoDotChange,
  tools,
  defaultTool,
  commitMenu,
  onLocateCommit,
  onSwap,
  onExternalDiff,
  onExternalCommitFileDiff,
  onDirectoryDiff,
  onBack,
}: CompareViewProps) {
  const { t } = useI18n();
  const result = loader.result;
  const compareKey = `${base.oid}:${compare.oid}`;
  const [viewTab, setViewTab] = useState<"commits" | "files">("commits");
  const [autoTabKey, setAutoTabKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CompareStatusFilterValue>("all");
  const [bothOnly, setBothOnly] = useState(false);
  const bothCount = useMemo(
    () => (result?.files ?? []).filter((file) => file.change_origin === "both").length,
    [result],
  );
  const files = useMemo(
    () =>
      (result?.files ?? []).filter(
        (file) =>
          matchesStatusBucket(file.status, statusFilter) &&
          (!bothOnly || file.change_origin === "both"),
      ),
    [result, statusFilter, bothOnly],
  );
  const [filePath, setFilePath] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState(false);
  // 放大视图内切换文件时保留上一份内容，等新 diff 到达再替换。
  const [lastDiff, setLastDiff] = useState<FileDiffDto | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [commitMenuPos, setCommitMenuPos] = useState<{
    x: number;
    y: number;
    commit: CommitSummaryDto;
  } | null>(null);
  const defaultToolIndex = Math.max(
    0,
    tools.findIndex((tool) => tool.name === defaultTool),
  );
  const [toolIndex, setToolIndex] = useState(defaultToolIndex);
  const diff = useCompareFileDiff(base, compare, filePath, repoGeneration, twoDot);
  const safeToolIndex = Math.min(toolIndex, Math.max(0, tools.length - 1));

  // 设置里更换默认工具或增删工具后，重新落到默认项。
  useEffect(() => {
    setToolIndex(defaultToolIndex);
  }, [defaultToolIndex, tools.length]);
  const activeTool = tools[safeToolIndex];
  // 工作区一侧没有提交对象：外部工具（单文件与目录对比）只接受提交，整组入口下线。
  const worktreeInvolved = isWorktreeSlot(base) || isWorktreeSlot(compare);
  // Base 与 Compare 指向同一提交时优先给出明确提示，避免被误认为功能失效。
  const sameTip = Boolean(result && result.files.length === 0 && base.oid === compare.oid);
  // 三点 diff 为空（祖先关系或两端工作树一致）时解释原因并提供两点快照入口。
  const emptyHint = Boolean(
    result && result.mode === "three_dot" && !sameTip && result.files.length === 0,
  );

  // 状态筛选可能过滤掉当前打开的文件：此时回落到筛选后的第一个文件。
  useEffect(() => {
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [files]);

  useEffect(() => {
    if (diff.data) {
      setLastDiff(diff.data);
    }
  }, [diff.data]);

  const totalCommitDiffCount =
    (result?.commits.length ?? 0) + (result?.base_commits.length ?? 0);

  // 每次切换对比对并拿到结果时，有提交差异默认进「按提交」，工作区或无提交差异默认进「按文件」。
  useEffect(() => {
    if (!result || autoTabKey === compareKey) {
      return;
    }
    setAutoTabKey(compareKey);
    if (!worktreeInvolved && (result.commits.length > 0 || result.base_commits.length > 0)) {
      setViewTab("commits");
    } else {
      setViewTab("files");
    }
  }, [result, compareKey, autoTabKey, worktreeInvolved]);

  useEffect(() => {
    setExpandedDiff(false);
    setBothOnly(false);
    setAutoTabKey(null);
  }, [base.oid, compare.oid]);

  useEffect(() => {
    if (diff.error) {
      setExpandedDiff(false);
    }
  }, [diff.error]);

  const shownDiff = diff.data ?? (expandedDiff ? lastDiff : null);

  const totalAdd = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDel = files.reduce((sum, file) => sum + file.deletions, 0);

  // 文件右键：文件历史 / Blame 以对比侧的提交为起点，其后是外部工具。
  const historyOid = isWorktreeSlot(compare) ? base.oid : compare.oid;
  const menuItems: MenuItem[] = menu
    ? [
        ...fileHistoryMenuItems(menu.path, historyOid, "compare"),
        ...(worktreeInvolved
          ? [
              {
                label: t("compare.externalWorktreeUnavailable"),
                disabled: true,
                onSelect: () => undefined,
              },
            ]
          : tools.length === 0
            ? [{ label: t("compare.noExternalTool"), disabled: true, onSelect: () => undefined }]
            : tools.map((tool, index) => ({
                label: t("compare.openWithTool", { name: tool.name }),
                onSelect: () => onExternalDiff(index, menu.path),
              }))),
      ]
    : [];

  return (
    <section className="compare-view">
      <CompareHeader
        base={base}
        compare={compare}
        twoDot={twoDot}
        onTwoDotChange={onTwoDotChange}
        result={result}
        totalAdd={totalAdd}
        totalDel={totalDel}
        filteredFileCount={files.length}
        filteredActive={statusFilter !== "all" || bothOnly}
        hasExternalTools={tools.length > 0}
        worktreeInvolved={worktreeInvolved}
        onLocateCommit={onLocateCommit}
        onSwap={onSwap}
        onDirectoryDiff={() => onDirectoryDiff(safeToolIndex)}
        onShowBothFiles={() => {
          setViewTab("files");
          setBothOnly(true);
        }}
        onBack={onBack}
      />

      {loader.loading && <p className="muted">{t("compare.computing")}</p>}
      {loader.error && <div className="banner danger">{loader.error}</div>}
      {result?.mode === "two_dot_fallback" && (
        <div className="banner warning">{t("compare.noCommonAncestor")}</div>
      )}
      {sameTip && (
        <div className="banner info compact">
          {t("compare.sameCommitTip", { oid: base.oid.slice(0, 8) })}
        </div>
      )}
      {emptyHint && (
        <div className="banner info compact">
          {t("compare.emptyThreeDot")}
          <button className="link" onClick={() => onTwoDotChange(true)}>
            {t("compare.switchToTwoDot")}
          </button>
        </div>
      )}
      {result?.warnings.map((warning) => (
        <div className="banner info compact" key={warning.code}>
          {warningText(warning)}
        </div>
      ))}
      {result && result.files.length > 0 && files.length === 0 && (
        <div className="banner info compact">{t("compare.filterEmpty")}</div>
      )}

      {result && (
        <>
          <div className="compare-view-tabs" role="tablist" aria-label={t("compare.viewTabsAria")}>
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === "commits"}
              className={viewTab === "commits" ? "active" : ""}
              disabled={worktreeInvolved}
              title={worktreeInvolved ? t("compare.worktreeNoCommits") : undefined}
              onClick={() => setViewTab("commits")}
            >
              {t("compare.tabByCommits", { n: totalCommitDiffCount })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === "files"}
              className={viewTab === "files" ? "active" : ""}
              onClick={() => setViewTab("files")}
            >
              {t("compare.tabByFiles", { n: result.files.length })}
            </button>
          </div>

          {viewTab === "commits" && !worktreeInvolved ? (
            <CompareCommitExplorer
              repoGeneration={repoGeneration}
              compareKey={compareKey}
              baseLabel={base.label}
              compareLabel={compare.label}
              compareCommits={result.commits}
              compareTruncated={result.commits_truncated}
              baseCommits={result.base_commits}
              baseTruncated={result.base_commits_truncated}
              equivalentMap={result.equivalent_commits}
              tools={tools}
              onExternalFileDiff={onExternalCommitFileDiff}
              onLocateCommit={onLocateCommit}
              onCommitContextMenu={(event, commit) =>
                setCommitMenuPos({ x: event.clientX, y: event.clientY, commit })
              }
            />
          ) : (
            <>
              <div className="compare-filter">
                <label>
                  {t("compare.pathFilter")}
                  <input
                    value={pathFilter}
                    placeholder={t("compare.pathFilterPlaceholder")}
                    onChange={(event) => onPathFilterChange(event.target.value)}
                  />
                </label>
                {pathFilter && (
                  <button className="link" onClick={() => onPathFilterChange("")}>
                    {t("compare.clearFilter")}
                  </button>
                )}
                <CompareStatusFilter value={statusFilter} onChange={setStatusFilter} />
                {bothCount > 0 && (
                  <button
                    type="button"
                    className={bothOnly ? "compare-both-toggle active" : "compare-both-toggle"}
                    aria-pressed={bothOnly}
                    title={t("compare.filterBothHint")}
                    onClick={() => setBothOnly((prev) => !prev)}
                  >
                    {t("compare.filterBoth", { n: bothCount })}
                  </button>
                )}
                <span className="muted">{t("compare.changedFilesCount", { n: files.length })}</span>
                {tools.length > 0 && (
                  <span className="compare-tools">
                    <Select
                      compact
                      value={safeToolIndex}
                      onChange={(event) => setToolIndex(Number(event.target.value))}
                      aria-label={t("compare.selectTool")}
                      options={tools.map((tool, index) => ({ value: index, label: tool.name }))}
                    />
                    <button
                      disabled={!filePath || worktreeInvolved}
                      title={worktreeInvolved ? t("compare.externalWorktreeUnavailable") : undefined}
                      onClick={() => {
                        if (filePath) {
                          onExternalDiff(safeToolIndex, filePath);
                        }
                      }}
                    >
                      {t("compare.openCurrentFile", {
                        name: activeTool?.name ?? t("compare.externalToolFallback"),
                      })}
                    </button>
                  </span>
                )}
              </div>

              <div className="detail-columns compare-columns">
                <div className="compare-side">
                  <CompareFileList
                    files={files}
                    activePath={filePath}
                    twoDot={twoDot || result.mode === "two_dot"}
                    baseLabel={base.label}
                    compareLabel={compare.label}
                    onSelect={setFilePath}
                    onContextMenu={(event, path) =>
                      setMenu({ x: event.clientX, y: event.clientY, path })
                    }
                  />
                </div>

                <CompareDiffPane
                  diffKey={`compare:${base.oid}:${compare.oid}`}
                  diff={shownDiff}
                  loading={diff.loading}
                  error={diff.error}
                  files={files}
                  activePath={filePath}
                  onSelectFile={setFilePath}
                  onFileContextMenu={(event, path) => {
                    setFilePath(path);
                    setMenu({ x: event.clientX, y: event.clientY, path });
                  }}
                  expanded={expandedDiff}
                  onExpandedChange={setExpandedDiff}
                  sideLabels={{
                    left:
                      result.mode === "three_dot" && result.merge_base
                        ? t("compare.diffSideMergeBase", {
                            oid: result.merge_base.slice(0, 8),
                            base: base.label,
                          })
                        : base.label,
                    right: compare.label,
                  }}
                />
              </div>
            </>
          )}
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {commitMenuPos && (
        <ContextMenu
          x={commitMenuPos.x}
          y={commitMenuPos.y}
          items={commitMenu(commitMenuPos.commit)}
          onClose={() => setCommitMenuPos(null)}
        />
      )}
    </section>
  );
}
