import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Icon } from "../../assets/icons";
import type { FileDiffDto, FileStatus } from "../../shared/types";
import { noteText } from "../../shared/error";
import { FileListModeToggle } from "../../shared/FileListModeToggle";
import { buildFileTree, flattenVisibleTree, type FileTreeRow } from "../../shared/fileTree";
import { statusLabelKey } from "../../shared/fileStatus";
import { consumeEsc, isEventInBottomPanel } from "../../shared/esc";
import { altModifierLabel } from "../../shared/platform";
import { Select } from "../../shared/Select";
import { useDiffViewType } from "../../shared/useDiffViewType";
import { useFileListMode } from "../../shared/useFileListMode";
import { useIpcResource } from "../../shared/useIpcResource";
import { useResolvedTheme } from "../../shared/theme";
import { useI18n } from "../../i18n";
import { buildDiffTokens } from "./highlight";
import { HunkHeaderRow, type HunkActionsConfig } from "./HunkActions";
import { SplitDiffPanes } from "./SplitDiffPanes";
import { DiffSearchBar } from "./DiffSearchBar";
import { ImageDiffView } from "./ImageDiffView";
import { useDiffSearch } from "./useDiffSearch";
import { useIgnoreWhitespace } from "./diffOptions";

const DIFF_WRAP_KEY = "git-graph.diff-wrap";
const DIFF_FILES_OPEN_KEY = "git-graph.diff-files-open";

// 侧栏文件行高度初值（12px 文本 + 上下 padding + 2px 行间距）；文本行高随字体
// 而定，首帧后由 measureElement 按实际渲染高度（含行间距 padding）修正。
const EXPANDED_ROW_ESTIMATE = 28;
const EXPANDED_LIST_OVERSCAN = 12;

function storedWrap(): boolean {
  return localStorage.getItem(DIFF_WRAP_KEY) === "1";
}

function storedFilesOpen(): boolean {
  return localStorage.getItem(DIFF_FILES_OPEN_KEY) !== "0";
}

export interface DiffFileEntry {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

interface FileDiffViewProps {
  diff: FileDiffDto;
  files?: DiffFileEntry[];
  activePath?: string;
  onSelectFile?: (path: string) => void;
  /** 放大视图侧栏文件行的右键菜单；由调用方决定菜单内容与外部工具。 */
  onFileContextMenu?: (event: MouseEvent<HTMLButtonElement>, path: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  loading?: boolean;
  /**
   * 每个 hunk 头部的操作按钮（ADR 0027）：只有暂存区传入。未提供时 hunk 头部
   * 不渲染任何按钮，提交详情与对比视图保持纯只读。
   */
  hunkActions?: HunkActionsConfig;
  /** 左右（旧/新）两侧的来源标签；对比视图传入分支名，让用户一眼看出哪边属于哪个分支。 */
  sideLabels?: { left: string; right: string };
}

export function FileDiffView({
  diff,
  files,
  activePath,
  onSelectFile,
  onFileContextMenu,
  expanded,
  onExpandedChange,
  loading,
  hunkActions,
  sideLabels,
}: FileDiffViewProps) {
  const { t } = useI18n();
  // 并排 / 统一偏好跨视图共享并持久化，切换提交或重启后保持。
  const [viewType, setViewType] = useDiffViewType();
  const [wrap, setWrap] = useState(storedWrap);
  const [filesOpen, setFilesOpen] = useState(storedFilesOpen);
  const [ignoreWhitespace, setIgnoreWhitespace] = useIgnoreWhitespace();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const theme = useResolvedTheme();

  useEffect(() => {
    localStorage.setItem(DIFF_WRAP_KEY, wrap ? "1" : "0");
  }, [wrap]);

  useEffect(() => {
    localStorage.setItem(DIFF_FILES_OPEN_KEY, filesOpen ? "1" : "0");
  }, [filesOpen]);

  // 放大视图与 diff 内搜索共用同一个 Esc 捕获监听：先收搜索条，再收放大视图，
  // 打「已消费」标记让 App / 暂存区等外层让路。
  useEffect(() => {
    if (!expanded && !searchOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // 底部面板聚焦时 Esc 归面板内容（终端程序或日志视图），本层同样让路。
      if (isEventInBottomPanel(event)) {
        return;
      }
      consumeEsc(event);
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      onExpandedChange(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, searchOpen, onExpandedChange]);

  const parsed = useMemo(() => {
    if (!diff.patch) {
      return null;
    }
    const files = parseDiff(diff.patch);
    return files.find((file) => file.hunks.length > 0) ?? null;
  }, [diff.patch]);

  // 搜索只对已解析出文本的 diff 有意义；patch 变空（如忽略空白后无差异）时收起。
  useEffect(() => {
    if (searchOpen && parsed === null) {
      setSearchOpen(false);
    }
  }, [searchOpen, parsed]);

  // 语法高亮 token 异步构建：高亮失败时静默退回行内标记，不进错误态。
  const tokens = useIpcResource(
    [parsed, diff.language, theme],
    () => buildDiffTokens(parsed!.hunks, diff.language, theme),
    { enabled: parsed !== null },
  ).data;

  const pathLabel = diff.old_path && diff.old_path !== diff.path
    ? `${diff.old_path} → ${diff.path}`
    : diff.path;

  const imagePreview = Boolean(diff.image_before || diff.image_after);
  // hunk 序号由后端按「不带 -w」的 diff 生成（ADR-0027），忽略空白后块序列会漂移，
  // 因此暂存区的块操作在忽略空白期间整体下线，避免把补丁打到错误的块上。
  const hunkActionsBlocked = Boolean(hunkActions) && ignoreWhitespace;
  const effectiveHunkActions = hunkActionsBlocked ? undefined : hunkActions;
  const showWhitespaceToggle = (!diff.binary && !diff.gitlink) || ignoreWhitespace;

  const diffRootRef = useRef<HTMLElement>(null);
  const search = useDiffSearch(
    diffRootRef,
    searchQuery,
    searchOpen && parsed !== null,
    `${diff.path}|${diff.patch?.length ?? 0}|${viewType}|${wrap ? 1 : 0}|${tokens ? 1 : 0}`,
  );

  const fileEntries = files ?? [];
  const currentIndex = fileEntries.findIndex((file) => file.path === (activePath ?? diff.path));
  const switchable = !expanded && fileEntries.length > 1 && Boolean(onSelectFile);
  const listFiles = expanded && fileEntries.length > 0 && Boolean(onSelectFile);
  const showSidebar = listFiles && filesOpen;

  // 文件切换快捷键：Alt+↑/↓ 只在普通（非放大）diff 下生效；焦点在底部面板或
  // 有弹窗打开时让路，避免抢终端程序与输入框的按键。
  useEffect(() => {
    if (!switchable) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      if (isEventInBottomPanel(event) || document.querySelector(".modal-backdrop")) {
        return;
      }
      const next = fileEntries[currentIndex + (event.key === "ArrowUp" ? -1 : 1)];
      if (!next) {
        return;
      }
      event.preventDefault();
      onSelectFile?.(next.path);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switchable, currentIndex, fileEntries, onSelectFile]);

  const [listMode, setListMode] = useFileListMode();
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const sidebarTree = useMemo(() => buildFileTree(fileEntries), [fileEntries]);
  // 侧栏扁平 / 目录树统一成扁平行，交给同一个虚拟滚动。
  const sidebarRows = useMemo<FileTreeRow<DiffFileEntry>[]>(() => {
    if (listMode === "tree") {
      return flattenVisibleTree(sidebarTree, collapsedDirs);
    }
    return fileEntries.map((file) => ({
      kind: "file",
      key: `f:${file.path}`,
      path: file.path,
      name: file.path,
      depth: 0,
      item: file,
      dirPath: "",
    }));
  }, [listMode, sidebarTree, fileEntries, collapsedDirs]);

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

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  // 放大视图侧栏文件列表虚拟化：侧栏收起时 ref 置空，重新展开后自然重新测量。
  const sidebarVirtualizer = useVirtualizer({
    count: sidebarRows.length,
    getScrollElement: () => sidebarScrollRef.current,
    estimateSize: () => EXPANDED_ROW_ESTIMATE,
    overscan: EXPANDED_LIST_OVERSCAN,
    getItemKey: (index) => sidebarRows[index]?.key ?? index,
  });

  // 并排且不换行时一律自绘两栏：左右各自横向滚动，不再让整个 diff 一起横滚。
  const paneMode = viewType === "split" && !wrap;

  // hunk 头部行横跨整行：统一视图 3 列；并排 4 列，纯新增/删除（monotonous）时 2 列。
  const hunkColSpan =
    viewType === "unified" ? 3 : parsed?.type === "add" || parsed?.type === "delete" ? 2 : 4;

  return (
    <>
      {expanded && <div className="file-diff-backdrop" onClick={() => onExpandedChange(false)} />}
      <section
        ref={diffRootRef}
        className={expanded ? "file-diff expanded" : "file-diff"}
        aria-label={expanded ? t("diff.expandedViewLabel") : undefined}
      >
        <header className="file-diff-header">
          <div className="file-diff-title">
            <span className={`file-status file-status-${diff.status}`}>
              {t(statusLabelKey(diff.status))}
            </span>
            <span className="file-diff-path mono" title={pathLabel}>
              {pathLabel}
            </span>
            <span className="file-diff-stats">
              {loading && <span className="muted">{t("diff.loading")}</span>}
              <span className="diff-add">+{diff.additions}</span>
              <span className="diff-del">-{diff.deletions}</span>
              {diff.language && <span className="muted diff-language">{diff.language}</span>}
            </span>
          </div>
          <div className="file-diff-meta">
            {listFiles && (
              <button
                className={filesOpen ? "diff-icon-button with-count active" : "diff-icon-button with-count"}
                onClick={() => setFilesOpen((current) => !current)}
                aria-pressed={filesOpen}
                title={filesOpen ? t("diff.collapseFileList") : t("diff.expandFileList")}
                aria-label={filesOpen ? t("diff.collapseFileList") : t("diff.expandFileList")}
              >
                <Icon name="fileList" />
                <span className="diff-icon-count">{fileEntries.length}</span>
              </button>
            )}
            {parsed && (
              <div className="view-toggle" role="group" aria-label={t("diff.viewMode")}>
                <button
                  className={viewType === "split" ? "active" : ""}
                  onClick={() => setViewType("split")}
                  title={t("diff.splitView")}
                  aria-label={t("diff.splitView")}
                  aria-pressed={viewType === "split"}
                >
                  <Icon name="splitView" />
                </button>
                <button
                  className={viewType === "unified" ? "active" : ""}
                  onClick={() => setViewType("unified")}
                  title={t("diff.unifiedView")}
                  aria-label={t("diff.unifiedView")}
                  aria-pressed={viewType === "unified"}
                >
                  <Icon name="unifiedView" />
                </button>
              </div>
            )}
            <button
              className={wrap ? "diff-icon-button active" : "diff-icon-button"}
              onClick={() => setWrap((current) => !current)}
              aria-pressed={wrap}
              title={t("diff.wrapTitle")}
              aria-label={t("diff.wrap")}
            >
              <Icon name="wrap" />
            </button>
            {showWhitespaceToggle && (
              <button
                className={ignoreWhitespace ? "diff-icon-button active" : "diff-icon-button"}
                onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
                aria-pressed={ignoreWhitespace}
                title={t("diff.ignoreWhitespaceTitle")}
                aria-label={t("diff.ignoreWhitespace")}
              >
                <Icon name="whitespace" />
              </button>
            )}
            {parsed && (
              <button
                className={searchOpen ? "diff-icon-button active" : "diff-icon-button"}
                onClick={() => setSearchOpen((current) => !current)}
                aria-pressed={searchOpen}
                title={t("diff.searchTitle")}
                aria-label={t("diff.searchLabel")}
              >
                <Icon name="search" />
              </button>
            )}
            <button
              className={expanded ? "diff-icon-button active" : "diff-icon-button"}
              onClick={() => onExpandedChange(!expanded)}
              aria-pressed={expanded}
              title={expanded ? t("diff.restoreHint") : t("diff.expandHint")}
              aria-label={expanded ? t("diff.restoreView") : t("diff.expandView")}
            >
              <Icon name={expanded ? "restore" : "expand"} />
            </button>
          </div>
        </header>

        {searchOpen && parsed && (
          <DiffSearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            count={search.count}
            activeIndex={search.activeIndex}
            onNext={search.next}
            onPrev={search.prev}
            onClose={() => setSearchOpen(false)}
          />
        )}

        <div className="file-diff-body">
          {showSidebar && (
            <aside className="expanded-files" aria-label={t("diff.changedFileList")}>
              <div className="expanded-files-head">
                <span>{t("diff.changedFiles")}</span>
                <span className="expanded-files-head-actions">
                  <span className="muted">{fileEntries.length}</span>
                  <FileListModeToggle mode={listMode} onChange={setListMode} />
                </span>
              </div>
              <div className="expanded-files-scroll" ref={sidebarScrollRef}>
                <ul
                  className="expanded-files-inner"
                  style={{ height: sidebarVirtualizer.getTotalSize() }}
                >
                  {sidebarVirtualizer.getVirtualItems().map((item) => {
                    const row = sidebarRows[item.index];
                    if (!row) {
                      return null;
                    }
                    return (
                      <li
                        key={item.key}
                        data-index={item.index}
                        ref={(node) => sidebarVirtualizer.measureElement(node)}
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
                            style={{ paddingLeft: 6 + row.depth * 12 }}
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
                              row.item.path === (activePath ?? diff.path) ? "active" : ""
                            }
                            style={
                              listMode === "tree" ? { paddingLeft: 6 + row.depth * 12 } : undefined
                            }
                            onClick={() => onSelectFile?.(row.item.path)}
                            onContextMenu={(event) => {
                              if (!onFileContextMenu) {
                                return;
                              }
                              event.preventDefault();
                              onFileContextMenu(event, row.item.path);
                            }}
                            title={
                              onFileContextMenu
                                ? t("diff.fileContextMenuHint", { path: row.item.path })
                                : row.item.path
                            }
                            aria-current={
                              row.item.path === (activePath ?? diff.path) ? "true" : undefined
                            }
                          >
                            <span className={`file-status file-status-${row.item.status}`}>
                              {t(statusLabelKey(row.item.status))}
                            </span>
                            <span className="file-path">{row.name}</span>
                            <span className="file-stats">
                              <span className="diff-add">+{row.item.additions}</span>
                              <span className="diff-del">-{row.item.deletions}</span>
                            </span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          )}

          <div className="file-diff-main">
            {switchable && (
              <div className="diff-file-nav">
                <button
                  disabled={currentIndex <= 0}
                  onClick={() => onSelectFile?.(fileEntries[currentIndex - 1].path)}
                  title={t("diff.previousFileHint", { keys: `${altModifierLabel()}+↑` })}
                  aria-label={t("diff.previousFile")}
                >
                  ‹
                </button>
                <Select
                  className="diff-file-picker"
                  compact
                  value={activePath ?? diff.path}
                  onChange={(event) => onSelectFile?.(event.target.value)}
                  aria-label={t("diff.switchFile")}
                  title={activePath ?? diff.path}
                  options={fileEntries.map((file, index) => ({
                    value: file.path,
                    label: t("diff.filePickerLabel", {
                      index: index + 1,
                      total: fileEntries.length,
                      path: file.path,
                    }),
                  }))}
                />
                <button
                  disabled={currentIndex < 0 || currentIndex >= fileEntries.length - 1}
                  onClick={() => onSelectFile?.(fileEntries[currentIndex + 1].path)}
                  title={t("diff.nextFileHint", { keys: `${altModifierLabel()}+↓` })}
                  aria-label={t("diff.nextFile")}
                >
                  ›
                </button>
              </div>
            )}

            {hunkActionsBlocked && (
              <div className="banner info compact">{t("diff.hunkActionsWhitespaceHint")}</div>
            )}
            {diff.note &&
              !(
                diff.binary ||
                diff.too_large ||
                diff.truncated ||
                diff.gitlink ||
                diff.encoding_fallback
              ) && <div className="banner info compact">{noteText(diff)}</div>}
            {diff.binary && !imagePreview && (
              <div className="banner info compact">{t("diff.binaryFile")}</div>
            )}
            {diff.too_large && (
              <div className="banner warning compact">{t("diff.tooLarge")}</div>
            )}
            {diff.truncated && (
              <div className="banner warning compact">{t("diff.truncated")}</div>
            )}
            {diff.encoding_fallback && (
              <div className="banner info compact">{t("diff.encodingFallback")}</div>
            )}
            {diff.gitlink && (
              <div className="banner info compact">
                {t("diff.gitlinkChanged")}
                <code>{(diff.gitlink_old ?? t("diff.gitlinkEmpty")).slice(0, 12)}</code> →{" "}
                <code>{(diff.gitlink_new ?? t("diff.gitlinkEmpty")).slice(0, 12)}</code>
                {t("diff.gitlinkNoExpand")}
              </div>
            )}

            {imagePreview ? (
              <ImageDiffView diff={diff} />
            ) : parsed ? (
              <>
                {sideLabels && (
                  <div className={paneMode ? "diff-side-headers split" : "diff-side-headers unified"}>
                    <span className="diff-side-label left" title={sideLabels.left}>
                      <span className="diff-side-mark del">−</span>
                      <span className="diff-side-text">{sideLabels.left}</span>
                    </span>
                    {!paneMode && <span className="muted">→</span>}
                    <span className="diff-side-label right" title={sideLabels.right}>
                      <span className="diff-side-mark add">+</span>
                      <span className="diff-side-text">{sideLabels.right}</span>
                    </span>
                  </div>
                )}
                {paneMode ? (
                  <SplitDiffPanes
                    hunks={parsed.hunks}
                    tokens={tokens?.tokens ?? null}
                    hunkActions={effectiveHunkActions}
                  />
                ) : (
                  <div className={wrap ? "diff-view wrap" : "diff-view"}>
                    <Diff
                      viewType={viewType}
                      diffType={parsed.type}
                      hunks={parsed.hunks}
                      tokens={tokens?.tokens}
                    >
                      {(hunks) =>
                        hunks.map((hunk, index) => (
                          // 块序号即 patch 中的顺序（0 起始），与后端 hunk_index 同源。
                          <Fragment key={hunk.content}>
                            {effectiveHunkActions && (
                              <HunkHeaderRow
                                content={hunk.content}
                                index={index}
                                total={hunks.length}
                                colSpan={hunkColSpan}
                                actions={effectiveHunkActions}
                              />
                            )}
                            <Hunk hunk={hunk} />
                          </Fragment>
                        ))
                      }
                    </Diff>
                  </div>
                )}
                {parsed.hunks.length > 0 && !tokens?.highlighted && diff.language && (
                  <p className="diff-note muted">{t("diff.noHighlight")}</p>
                )}
              </>
            ) : (
              !diff.binary && !diff.gitlink && !diff.too_large && (
                <p className="muted">{t("diff.noTextDiff")}</p>
              )
            )}
          </div>
        </div>
      </section>
    </>
  );
}
