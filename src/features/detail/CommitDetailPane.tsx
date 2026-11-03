import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import { warningText } from "../../shared/error";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { STATUS_LETTER } from "../../shared/fileStatus";
import { formatDate, shortOid } from "../../shared/format";
import type {
  CommitSummaryDto,
  ExternalToolConfig,
  FileDiffDto,
  RepoStateDto,
} from "../../shared/types";
import { FileDiffView } from "../diff/FileDiffView";
import { useBranchesContaining, useCommitDetail, useFileDiff } from "./useCommitDetail";

// 文件行高度初值（12px 文本 + 上下 padding 与边框）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const FILE_ROW_ESTIMATE = 26;
const FILE_LIST_OVERSCAN = 12;

function RefBadges({ commit }: { commit: CommitSummaryDto }) {
  if (commit.refs.length === 0) {
    return null;
  }
  return (
    <span className="detail-refs">
      {commit.refs.map((badge) => (
        <span
          key={`${badge.kind}:${badge.name}`}
          className={[
            "ref-badge",
            `ref-${badge.kind}`,
            badge.is_head ? "ref-head" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={`${badge.kind} · ${badge.name}`}
        >
          {badge.is_head ? "HEAD → " : ""}
          {badge.name}
        </span>
      ))}
    </span>
  );
}

interface CommitDetailPaneProps {
  repo: RepoStateDto;
  oid: string;
  tools: ExternalToolConfig[];
  width: number;
  onClose: () => void;
  onBranchJump: (branch: string) => void;
  onExternalDiff: (toolIndex: number, path: string, left: string | null) => void;
}

export function CommitDetailPane({
  repo,
  oid,
  tools,
  width,
  onClose,
  onBranchJump,
  onExternalDiff,
}: CommitDetailPaneProps) {
  const { t } = useI18n();
  const detail = useCommitDetail(oid, repo.generation);
  const branches = useBranchesContaining(oid, repo.generation);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [expandedDiff, setExpandedDiff] = useState(false);
  // 放大视图内切换文件时保留上一份内容，等新 diff 到达再替换，避免遮罩闪退。
  const [lastDiff, setLastDiff] = useState<FileDiffDto | null>(null);
  const fileDiff = useFileDiff(oid, filePath, repo.generation);

  useEffect(() => {
    if (fileDiff.data) {
      setLastDiff(fileDiff.data);
    }
  }, [fileDiff.data]);

  useEffect(() => {
    setExpandedDiff(false);
  }, [oid]);

  useEffect(() => {
    if (fileDiff.error) {
      setExpandedDiff(false);
    }
  }, [fileDiff.error]);

  useEffect(() => {
    const files = detail.data?.files ?? [];
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [detail.data]);

  const commit = detail.data?.commit;
  const files = detail.data?.files ?? [];
  const shownDiff = fileDiff.data ?? (expandedDiff ? lastDiff : null);
  const baseOid = detail.data?.parents[0] ?? null;

  const fileScrollRef = useRef<HTMLDivElement>(null);
  // 变更文件列表虚拟化：大合并提交数千文件时只渲染可视行。
  const fileVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => fileScrollRef.current,
    estimateSize: () => FILE_ROW_ESTIMATE,
    overscan: FILE_LIST_OVERSCAN,
    getItemKey: (index) => files[index]?.path ?? index,
  });

  const menuItems: MenuItem[] =
    tools.length === 0
      ? [{ label: t("detail.noExternalTool"), disabled: true, onSelect: () => undefined }]
      : tools.map((tool, index) => ({
          label: t("detail.openWithTool", { name: tool.name }),
          onSelect: () => {
            if (menu) {
              onExternalDiff(index, menu.path, baseOid);
            }
          },
        }));

  return (
    <aside className="detail-pane" aria-label={t("detail.commitDetails")} style={{ width }}>
      <header className="detail-header">
        <div className="detail-title-row">
          <div>
            <h2 className="detail-summary">{commit?.summary || t("detail.commitDetails")}</h2>
            {commit && (
              <div className="detail-sub mono" title={commit.oid}>
                {commit.oid}
              </div>
            )}
          </div>
          <button className="detail-close" onClick={onClose} aria-label={t("detail.closeAria")}>
            ×
          </button>
        </div>
        {commit && (
          <div className="detail-meta">
            <span>{commit.author_name}</span>
            <span className="muted">{commit.author_email}</span>
            <span className="muted">{formatDate(commit.authored_at)}</span>
            <RefBadges commit={commit} />
          </div>
        )}
      </header>

      <div className="detail-scroll">
        {detail.loading && <p className="muted">{t("detail.loading")}</p>}
        {detail.error && <div className="banner danger">{detail.error}</div>}

        {detail.data && (
          <>
            {/* 说明与元信息合成一块：过长时只有这一块滚动，diff 区始终占满剩余高度。 */}
            <div className="detail-info">
              <details className="commit-message-block" open>
                <summary>{t("detail.commitMessage")}</summary>
                <pre className="commit-message">{detail.data.message.trimEnd()}</pre>
              </details>

              <div className="detail-facts">
                <span className="muted">{t("detail.parents")}</span>
                {detail.data.parents.length === 0 ? (
                  <span>{t("detail.rootCommit")}</span>
                ) : (
                  <span className="parent-list">
                    {detail.data.parents.map((parent) => (
                      <code key={parent} title={parent}>
                        {shortOid(parent)}
                      </code>
                    ))}
                  </span>
                )}
              </div>

              <div className="detail-facts">
                <span className="muted">{t("detail.containingBranches")}</span>
                {branches.length === 0 ? (
                  <span className="muted">{t("detail.noContainingBranches")}</span>
                ) : (
                  <span className="branch-list">
                    {branches.map((branch) => (
                      <button
                        key={branch}
                        className="branch-chip"
                        onClick={() => onBranchJump(branch)}
                        title={t("detail.branchJumpTitle", { branch })}
                      >
                        {branch}
                      </button>
                    ))}
                  </span>
                )}
              </div>

              <div
                className={
                  detail.data.baseline === "merge_first_parent"
                    ? "baseline-note merge"
                    : "baseline-note muted"
                }
              >
                {
                  detail.data.baseline === "root"
                    ? t("detail.baselineRoot")
                    : detail.data.baseline === "merge_first_parent"
                      ? t("detail.baselineMerge")
                      : t("detail.baselineFirstParent")
                }
              </div>

              {detail.data.warnings.map((warning) => (
                <div className="banner warning compact" key={warning.code}>
                  {warningText(warning)}
                </div>
              ))}
            </div>

            <div className="detail-columns">
              <div className="detail-files">
                <h3>{t("detail.changedFiles", { n: files.length })}</h3>
                {files.length === 0 ? (
                  <p className="muted">{t("detail.noFileChanges")}</p>
                ) : (
                  <div className="file-list" ref={fileScrollRef}>
                    <ul
                      className="file-list-inner"
                      style={{ height: fileVirtualizer.getTotalSize() }}
                    >
                      {fileVirtualizer.getVirtualItems().map((item) => {
                        const file = files[item.index];
                        if (!file) {
                          return null;
                        }
                        return (
                          <li
                            key={item.key}
                            data-index={item.index}
                            ref={(node) => fileVirtualizer.measureElement(node)}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              transform: `translateY(${item.start}px)`,
                            }}
                          >
                            <button
                              className={
                                filePath === file.path ? "file-row active" : "file-row"
                              }
                              onClick={() => setFilePath(file.path)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setFilePath(file.path);
                                setMenu({ x: event.clientX, y: event.clientY, path: file.path });
                              }}
                              title={t("detail.fileRowTitle", { path: file.path })}
                            >
                              <span className={`file-status file-status-${file.status}`}>
                                {STATUS_LETTER[file.status]}
                              </span>
                              <span className="file-path">{file.path}</span>
                              <span className="file-stats">
                                {file.gitlink ? (
                                  <span className="muted">gitlink</span>
                                ) : file.binary ? (
                                  <span className="muted">bin</span>
                                ) : (
                                  <>
                                    <span className="diff-add">+{file.additions}</span>
                                    <span className="diff-del">-{file.deletions}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <div className="detail-diff">
                {fileDiff.loading && !expandedDiff && (
                  <p className="muted">{t("detail.fileDiffLoading")}</p>
                )}
                {fileDiff.error && <div className="banner danger">{fileDiff.error}</div>}
                {shownDiff && (
                  <FileDiffView
                    key={oid}
                    diff={shownDiff}
                    files={files}
                    activePath={filePath ?? undefined}
                    onSelectFile={setFilePath}
                    onFileContextMenu={(event, path) => {
                      setFilePath(path);
                      setMenu({ x: event.clientX, y: event.clientY, path });
                    }}
                    expanded={expandedDiff}
                    onExpandedChange={setExpandedDiff}
                    loading={fileDiff.loading}
                  />
                )}
                {!fileDiff.loading && !shownDiff && !fileDiff.error && files.length > 0 && (
                  <p className="muted">{t("detail.selectFileHint")}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}
