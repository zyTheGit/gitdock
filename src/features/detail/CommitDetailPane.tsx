import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { warningText } from "../../shared/error";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { FileListModeToggle } from "../../shared/FileListModeToggle";
import { buildFileTree, flattenVisibleTree, type FileTreeRow } from "../../shared/fileTree";
import { STATUS_LETTER } from "../../shared/fileStatus";
import { formatDate, shortOid } from "../../shared/format";
import type {
  ChangedFileDto,
  CommitSummaryDto,
  ExternalToolConfig,
  FileDiffDto,
  RepoStateDto,
} from "../../shared/types";
import { useFileListMode } from "../../shared/useFileListMode";
import { FileDiffView } from "../diff/FileDiffView";
import { fileHistoryMenuItems } from "../history/menuItems";
import { useBranchesContaining, useCommitDetail, useFileDiff } from "./useCommitDetail";

// 文件行高度初值（12px 文本 + 上下 padding 与边框）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const FILE_ROW_ESTIMATE = 26;
const FILE_LIST_OVERSCAN = 12;

/** 已知签名类型的展示名；未识别的类型原样展示（ADR-0034）。 */
const SIGNATURE_LABELS: Record<string, string> = { gpg: "GPG", ssh: "SSH", x509: "X.509" };

function signatureLabel(kind: string): string {
  return SIGNATURE_LABELS[kind] ?? kind;
}

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
  /** 点击父提交短哈希：定位并选中该提交（必要时切换范围）。 */
  onSelectCommit?: (oid: string) => void;
  onExternalDiff: (toolIndex: number, path: string, left: string | null) => void;
}

export function CommitDetailPane({
  repo,
  oid,
  tools,
  width,
  onClose,
  onBranchJump,
  onSelectCommit,
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

  const [listMode, setListMode] = useFileListMode();
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  // 扁平 / 目录树统一成扁平行：虚拟滚动只按行索引取数据，不递归挂载 DOM。
  const rows = useMemo<FileTreeRow<ChangedFileDto>[]>(() => {
    if (listMode === "tree") {
      return flattenVisibleTree(fileTree, collapsedDirs);
    }
    return files.map((file) => ({
      kind: "file",
      key: `f:${file.path}`,
      path: file.path,
      name: file.path,
      depth: 0,
      item: file,
      dirPath: "",
    }));
  }, [listMode, fileTree, files, collapsedDirs]);

  const toggleDir = (path: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

  const fileScrollRef = useRef<HTMLDivElement>(null);
  // 变更文件列表虚拟化：大合并提交数千文件时只渲染可视行。
  const fileVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => fileScrollRef.current,
    estimateSize: () => FILE_ROW_ESTIMATE,
    overscan: FILE_LIST_OVERSCAN,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  // 文件右键：先给只读的文件历史 / Blame，再列外部对比工具（未配置时给出占位项）。
  const menuItems: MenuItem[] = menu
    ? [
        ...fileHistoryMenuItems(menu.path, oid, "commit"),
        ...(tools.length === 0
          ? [{ label: t("detail.noExternalTool"), disabled: true, onSelect: () => undefined }]
          : tools.map((tool, index) => ({
              label: t("detail.openWithTool", { name: tool.name }),
              onSelect: () => onExternalDiff(index, menu.path, baseOid),
            }))),
      ]
    : [];

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
            {detail.data?.signature_kind && (
              <span
                className="signature-badge"
                title={t("detail.signatureTitle", {
                  kind: signatureLabel(detail.data.signature_kind),
                })}
              >
                {t("detail.signatureSigned", {
                  kind: signatureLabel(detail.data.signature_kind),
                })}
              </span>
            )}
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
                      <button
                        key={parent}
                        type="button"
                        className="parent-oid mono"
                        title={t("detail.parentJumpTitle", { oid: parent })}
                        onClick={() => onSelectCommit?.(parent)}
                        disabled={!onSelectCommit}
                      >
                        {shortOid(parent)}
                      </button>
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
                <div className="detail-files-head">
                  <h3>{t("detail.changedFiles", { n: files.length })}</h3>
                  {files.length > 0 && (
                    <FileListModeToggle mode={listMode} onChange={setListMode} />
                  )}
                </div>
                {files.length === 0 ? (
                  <p className="muted">{t("detail.noFileChanges")}</p>
                ) : (
                  <div className="file-list" ref={fileScrollRef}>
                    <ul
                      className="file-list-inner"
                      style={{ height: fileVirtualizer.getTotalSize() }}
                    >
                      {fileVirtualizer.getVirtualItems().map((item) => {
                        const row = rows[item.index];
                        if (!row) {
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
                            {row.kind === "dir" ? (
                              <button
                                className="file-tree-dir"
                                style={{ paddingLeft: 4 + row.depth * 12 }}
                                aria-expanded={!collapsedDirs.has(row.path)}
                                onClick={() => toggleDir(row.path)}
                                title={row.path}
                              >
                                <Icon name="chevronDown" className="file-tree-chevron" />
                                <span className="file-tree-name">{row.name}</span>
                                <span className="file-tree-count">{row.fileCount}</span>
                              </button>
                            ) : (
                              <button
                                className={
                                  filePath === row.item.path ? "file-row active" : "file-row"
                                }
                                style={
                                  listMode === "tree"
                                    ? { paddingLeft: 4 + row.depth * 12 }
                                    : undefined
                                }
                                onClick={() => setFilePath(row.item.path)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setFilePath(row.item.path);
                                  setMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    path: row.item.path,
                                  });
                                }}
                                title={t("detail.fileRowTitle", {
                                  path:
                                    row.item.old_path && row.item.old_path !== row.item.path
                                      ? `${row.item.old_path} → ${row.item.path}`
                                      : row.item.path,
                                })}
                              >
                                <span className={`file-status file-status-${row.item.status}`}>
                                  {STATUS_LETTER[row.item.status]}
                                </span>
                                <span className="file-path">{row.name}</span>
                                <span className="file-stats">
                                  {row.item.gitlink ? (
                                    <span className="muted">gitlink</span>
                                  ) : row.item.binary ? (
                                    <span className="muted">bin</span>
                                  ) : (
                                    <>
                                      <span className="diff-add">+{row.item.additions}</span>
                                      <span className="diff-del">-{row.item.deletions}</span>
                                    </>
                                  )}
                                </span>
                              </button>
                            )}
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
                    sideLabels={
                      detail.data
                        ? {
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
                            right: t("diff.sideCommit", {
                              oid: detail.data.commit.short_oid,
                            }),
                          }
                        : undefined
                    }
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
