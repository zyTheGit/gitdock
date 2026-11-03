import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import type { CommitSummaryDto, ExternalToolConfig, FileDiffDto } from "../../shared/types";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { Select } from "../../shared/Select";
import { CompareCommitList } from "./CompareCommitList";
import { CompareDiffPane } from "./CompareDiffPane";
import { CompareFileList } from "./CompareFileList";
import { CompareHeader } from "./CompareHeader";
import type { CompareLoader, CompareSlot } from "./useCompare";
import { useCompareFileDiff } from "./useCompare";

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
  onOpenCommit: (oid: string) => void;
  onExternalDiff: (toolIndex: number, path: string) => void;
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
  onOpenCommit,
  onExternalDiff,
  onBack,
}: CompareViewProps) {
  const { t } = useI18n();
  const result = loader.result;
  const files = result?.files ?? [];
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
  // Base 与 Compare 指向同一提交时优先给出明确提示，避免被误认为功能失效。
  const sameTip = Boolean(result && result.files.length === 0 && base.oid === compare.oid);
  // 三点 diff 为空（祖先关系或两端工作树一致）时解释原因并提供两点快照入口。
  const emptyHint = Boolean(result && !twoDot && !sameTip && result.files.length === 0);

  useEffect(() => {
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [result]);

  useEffect(() => {
    if (diff.data) {
      setLastDiff(diff.data);
    }
  }, [diff.data]);

  useEffect(() => {
    setExpandedDiff(false);
  }, [base.oid, compare.oid]);

  useEffect(() => {
    if (diff.error) {
      setExpandedDiff(false);
    }
  }, [diff.error]);

  const shownDiff = diff.data ?? (expandedDiff ? lastDiff : null);

  const totalAdd = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDel = files.reduce((sum, file) => sum + file.deletions, 0);

  const menuItems: MenuItem[] =
    tools.length === 0
      ? [{ label: t("compare.noExternalTool"), disabled: true, onSelect: () => undefined }]
      : tools.map((tool, index) => ({
          label: t("compare.openWithTool", { name: tool.name }),
          onSelect: () => {
            if (menu) {
              onExternalDiff(index, menu.path);
            }
          },
        }));

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
          {warning.message}
        </div>
      ))}

      {result && (
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
                  disabled={!filePath}
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
                onSelect={setFilePath}
                onContextMenu={(event, path) =>
                  setMenu({ x: event.clientX, y: event.clientY, path })
                }
              />
              <CompareCommitList
                commits={result.commits}
                truncated={result.commits_truncated}
                onOpen={onOpenCommit}
                onContextMenu={(event, commit) =>
                  setCommitMenuPos({ x: event.clientX, y: event.clientY, commit })
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
            />
          </div>
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
