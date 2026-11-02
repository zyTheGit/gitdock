import { useEffect, useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import type { FileDiffDto, FileStatus } from "../../shared/types";
import { STATUS_LABEL } from "../../shared/fileStatus";
import { Select } from "../../shared/Select";
import { useResolvedTheme } from "../../shared/theme";
import { buildDiffTokens } from "./highlight";
import { SplitDiffPanes } from "./SplitDiffPanes";

const DIFF_WRAP_KEY = "git-graph.diff-wrap";
const DIFF_FILES_OPEN_KEY = "git-graph.diff-files-open";

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
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  loading?: boolean;
}

export function FileDiffView({
  diff,
  files,
  activePath,
  onSelectFile,
  expanded,
  onExpandedChange,
  loading,
}: FileDiffViewProps) {
  const [viewType, setViewType] = useState<"split" | "unified">("split");
  const [wrap, setWrap] = useState(storedWrap);
  const [filesOpen, setFilesOpen] = useState(storedFilesOpen);
  const [tokens, setTokens] = useState<Awaited<ReturnType<typeof buildDiffTokens>> | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    localStorage.setItem(DIFF_WRAP_KEY, wrap ? "1" : "0");
  }, [wrap]);

  useEffect(() => {
    localStorage.setItem(DIFF_FILES_OPEN_KEY, filesOpen ? "1" : "0");
  }, [filesOpen]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onExpandedChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, onExpandedChange]);

  const parsed = useMemo(() => {
    if (!diff.patch) {
      return null;
    }
    const files = parseDiff(diff.patch);
    return files.find((file) => file.hunks.length > 0) ?? null;
  }, [diff.patch]);

  useEffect(() => {
    setTokens(null);
    if (!parsed) {
      return;
    }
    let cancelled = false;
    void buildDiffTokens(parsed.hunks, diff.language, theme).then((result) => {
      if (!cancelled) {
        setTokens(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [parsed, diff.language, theme]);

  const pathLabel = diff.old_path && diff.old_path !== diff.path
    ? `${diff.old_path} → ${diff.path}`
    : diff.path;

  const fileEntries = files ?? [];
  const currentIndex = fileEntries.findIndex((file) => file.path === (activePath ?? diff.path));
  const switchable = !expanded && fileEntries.length > 1 && Boolean(onSelectFile);
  const listFiles = expanded && fileEntries.length > 0 && Boolean(onSelectFile);
  const showSidebar = listFiles && filesOpen;
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
              <ul>
                {fileEntries.map((file) => {
                  const active = file.path === (activePath ?? diff.path);
                  return (
                    <li key={file.path}>
                      <button
                        className={active ? "active" : ""}
                        onClick={() => onSelectFile?.(file.path)}
                        title={file.path}
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
