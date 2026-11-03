import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import type { FileDiffDto, FileStatus } from "../../shared/types";
import { STATUS_LABEL } from "../../shared/fileStatus";
import { consumeEsc, isEventInTerminal } from "../../shared/esc";
import { Select } from "../../shared/Select";
import { useIpcResource } from "../../shared/useIpcResource";
import { useResolvedTheme } from "../../shared/theme";
import { buildDiffTokens } from "./highlight";
import { SplitDiffPanes } from "./SplitDiffPanes";

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
}: FileDiffViewProps) {
  const [viewType, setViewType] = useState<"split" | "unified">("split");
  const [wrap, setWrap] = useState(storedWrap);
  const [filesOpen, setFilesOpen] = useState(storedFilesOpen);

  const theme = useResolvedTheme();

  useEffect(() => {
    localStorage.setItem(DIFF_WRAP_KEY, wrap ? "1" : "0");
  }, [wrap]);

  useEffect(() => {
    localStorage.setItem(DIFF_FILES_OPEN_KEY, filesOpen ? "1" : "0");
  }, [filesOpen]);

  // 放大视图吃掉一次 Esc：捕获阶段先于所有冒泡层的全局监听执行，在事件上
  // 打「已消费」标记让 App / 暂存区等外层让路，只收起本层；不用
  // stopPropagation，避免连右键菜单等同样监听 Esc 的浮层一起吞掉。
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // 终端聚焦时 Esc 归终端程序，本层同样让路。
      if (isEventInTerminal(event)) {
        return;
      }
      consumeEsc(event);
      onExpandedChange(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, onExpandedChange]);

  const parsed = useMemo(() => {
    if (!diff.patch) {
      return null;
    }
    const files = parseDiff(diff.patch);
    return files.find((file) => file.hunks.length > 0) ?? null;
  }, [diff.patch]);

  // 语法高亮 token 异步构建：高亮失败时静默退回行内标记，不进错误态。
  const tokens = useIpcResource(
    [parsed, diff.language, theme],
    () => buildDiffTokens(parsed!.hunks, diff.language, theme),
    { enabled: parsed !== null },
  ).data;

  const pathLabel = diff.old_path && diff.old_path !== diff.path
    ? `${diff.old_path} → ${diff.path}`
    : diff.path;

  const fileEntries = files ?? [];
  const currentIndex = fileEntries.findIndex((file) => file.path === (activePath ?? diff.path));
  const switchable = !expanded && fileEntries.length > 1 && Boolean(onSelectFile);
  const listFiles = expanded && fileEntries.length > 0 && Boolean(onSelectFile);
  const showSidebar = listFiles && filesOpen;

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  // 放大视图侧栏文件列表虚拟化：侧栏收起时 ref 置空，重新展开后自然重新测量。
  const sidebarVirtualizer = useVirtualizer({
    count: fileEntries.length,
    getScrollElement: () => sidebarScrollRef.current,
    estimateSize: () => EXPANDED_ROW_ESTIMATE,
    overscan: EXPANDED_LIST_OVERSCAN,
    getItemKey: (index) => fileEntries[index]?.path ?? index,
  });

  // 并排且不换行时一律自绘两栏：左右各自横向滚动，不再让整个 diff 一起横滚。
  const paneMode = viewType === "split" && !wrap;

  return (
    <>
      {expanded && <div className="file-diff-backdrop" onClick={() => onExpandedChange(false)} />}
      <section
        className={expanded ? "file-diff expanded" : "file-diff"}
        aria-label={expanded ? "文件 diff 放大视图" : undefined}
      >
        <header className="file-diff-header">
          <div className="file-diff-title">
            <span className={`file-status file-status-${diff.status}`}>{STATUS_LABEL[diff.status]}</span>
            <span className="file-diff-path mono" title={pathLabel}>
              {pathLabel}
            </span>
            <span className="file-diff-stats">
              {loading && <span className="muted">读取中…</span>}
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
                title={filesOpen ? "收起变更文件列表" : "展开变更文件列表"}
                aria-label={filesOpen ? "收起变更文件列表" : "展开变更文件列表"}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4.5h7M6 8h7M6 11.5h7" />
                  <path d="M3 4.5h.01M3 8h.01M3 11.5h.01" />
                </svg>
                <span className="diff-icon-count">{fileEntries.length}</span>
              </button>
            )}
            {parsed && (
              <div className="view-toggle" role="group" aria-label="diff 视图模式">
                <button
                  className={viewType === "split" ? "active" : ""}
                  onClick={() => setViewType("split")}
                  title="并排显示"
                  aria-label="并排显示"
                  aria-pressed={viewType === "split"}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
                    <path d="M8 3.5v9" />
                  </svg>
                </button>
                <button
                  className={viewType === "unified" ? "active" : ""}
                  onClick={() => setViewType("unified")}
                  title="统一显示"
                  aria-label="统一显示"
                  aria-pressed={viewType === "unified"}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
                    <path d="M4.5 6.5h7M4.5 9.5h5" />
                  </svg>
                </button>
              </div>
            )}
            <button
              className={wrap ? "diff-icon-button active" : "diff-icon-button"}
              onClick={() => setWrap((current) => !current)}
              aria-pressed={wrap}
              title="长行自动换行，避免横向滚动"
              aria-label="长行自动换行"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 5h10M3 8h7a2 2 0 0 1 0 4H7" />
                <path d="M8.5 10.5 7 12l1.5 1.5" />
              </svg>
            </button>
            <button
              className={expanded ? "diff-icon-button active" : "diff-icon-button"}
              onClick={() => onExpandedChange(!expanded)}
              aria-pressed={expanded}
              title={expanded ? "还原（Esc）" : "放大到整个窗口查看 diff"}
              aria-label={expanded ? "还原 diff 视图" : "放大 diff 视图"}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {expanded ? (
                  <path d="M9 7 13 3M13 7V3H9M7 9 3 13M3 9v4h4" />
                ) : (
                  <path d="M13 3 9 7M9 3h4v4M3 13l4-4M7 13H3V9" />
                )}
              </svg>
            </button>
          </div>
        </header>

        <div className="file-diff-body">
          {showSidebar && (
            <aside className="expanded-files" aria-label="变更文件列表">
              <div className="expanded-files-head">
                <span>变更文件</span>
                <span className="muted">{fileEntries.length}</span>
              </div>
              <div className="expanded-files-scroll" ref={sidebarScrollRef}>
                <ul
                  className="expanded-files-inner"
                  style={{ height: sidebarVirtualizer.getTotalSize() }}
                >
                  {sidebarVirtualizer.getVirtualItems().map((item) => {
                    const file = fileEntries[item.index];
                    if (!file) {
                      return null;
                    }
                    const active = file.path === (activePath ?? diff.path);
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
                        <button
                          className={active ? "active" : ""}
                          onClick={() => onSelectFile?.(file.path)}
                          onContextMenu={(event) => {
                            if (!onFileContextMenu) {
                              return;
                            }
                            event.preventDefault();
                            onFileContextMenu(event, file.path);
                          }}
                          title={
                            onFileContextMenu
                              ? `${file.path}（右键可用外部工具对比）`
                              : file.path
                          }
                          aria-current={active ? "true" : undefined}
                        >
                          <span className={`file-status file-status-${file.status}`}>
                            {STATUS_LABEL[file.status]}
                          </span>
                          <span className="file-path">{file.path}</span>
                          <span className="file-stats">
                            <span className="diff-add">+{file.additions}</span>
                            <span className="diff-del">-{file.deletions}</span>
                          </span>
                        </button>
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
                  title="上一个文件"
                  aria-label="上一个文件"
                >
                  ‹
                </button>
                <Select
                  className="diff-file-picker"
                  compact
                  value={activePath ?? diff.path}
                  onChange={(event) => onSelectFile?.(event.target.value)}
                  aria-label="切换对比文件"
                  title={activePath ?? diff.path}
                  options={fileEntries.map((file, index) => ({
                    value: file.path,
                    label: `${index + 1}/${fileEntries.length} · ${file.path}`,
                  }))}
                />
                <button
                  disabled={currentIndex < 0 || currentIndex >= fileEntries.length - 1}
                  onClick={() => onSelectFile?.(fileEntries[currentIndex + 1].path)}
                  title="下一个文件"
                  aria-label="下一个文件"
                >
                  ›
                </button>
              </div>
            )}

            {diff.note &&
              !(
                diff.binary ||
                diff.too_large ||
                diff.truncated ||
                diff.gitlink ||
                diff.encoding_fallback
              ) && <div className="banner info compact">{diff.note}</div>}
            {diff.binary && (
              <div className="banner info compact">二进制文件，不显示文本 diff。</div>
            )}
            {diff.too_large && (
              <div className="banner warning compact">文件过大，仅显示变更统计，不加载内容。</div>
            )}
            {diff.truncated && (
              <div className="banner warning compact">diff 过长，已截断为前若干行。</div>
            )}
            {diff.encoding_fallback && (
              <div className="banner info compact">文件包含非 UTF-8 字节，已按替换字符显示。</div>
            )}
            {diff.gitlink && (
              <div className="banner info compact">
                子模块指针变更：
                <code>{(diff.gitlink_old ?? "（空）").slice(0, 12)}</code> →{" "}
                <code>{(diff.gitlink_new ?? "（空）").slice(0, 12)}</code>
                （不展开子模块内部 diff）
              </div>
            )}

            {parsed ? (
              <>
                {paneMode ? (
                  <SplitDiffPanes hunks={parsed.hunks} tokens={tokens?.tokens ?? null} />
                ) : (
                  <div className={wrap ? "diff-view wrap" : "diff-view"}>
                    <Diff
                      viewType={viewType}
                      diffType={parsed.type}
                      hunks={parsed.hunks}
                      tokens={tokens?.tokens}
                    >
                      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                    </Diff>
                  </div>
                )}
                {parsed.hunks.length > 0 && !tokens?.highlighted && diff.language && (
                  <p className="diff-note muted">
                    未启用语法高亮（语言不在支持列表或变更行数过多），已保留行内差异标记。
                  </p>
                )}
              </>
            ) : (
              !diff.binary && !diff.gitlink && !diff.too_large && (
                <p className="muted">该文件没有可显示的文本差异。</p>
              )
            )}
          </div>
        </div>
      </section>
    </>
  );
}
