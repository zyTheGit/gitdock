import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FileDiffView } from "../detail/FileDiffView";
import { STATUS_LABEL, STATUS_LETTER } from "../../shared/fileStatus";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  FileDiffDto,
  RepoStateDto,
  RepositoryChangedDto,
  StagingFileDto,
  StagingStatusDto,
} from "../../shared/types";

type Side = "staged" | "unstaged";

interface Selection {
  path: string;
  side: Side;
}

interface StagingViewProps {
  repo: RepoStateDto;
  /** 与写操作共用互斥：应用忙碌、中断态、bare 或 Git 版本不支持时禁用。 */
  writeDisabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onMutated: (message: string) => Promise<void>;
  onOpenTerminal: () => void;
  onExit: () => void;
}

const sideKey = (side: Side, path: string) => `${side}:${path}`;

function pathLabel(file: StagingFileDto): string {
  return file.old_path && file.old_path !== file.path
    ? `${file.old_path} → ${file.path}`
    : file.path;
}

function fileMeta(file: StagingFileDto) {
  if (file.untracked) {
    return <span className="muted">未跟踪</span>;
  }
  if (file.gitlink) {
    return <span className="muted">子模块</span>;
  }
  if (file.binary) {
    return <span className="muted">二进制</span>;
  }
  return (
    <>
      <span className="diff-add">+{file.additions}</span>
      <span className="diff-del">-{file.deletions}</span>
    </>
  );
}

export function StagingView({
  repo,
  writeDisabled,
  onBusyChange,
  onMutated,
  onOpenTerminal,
  onExit,
}: StagingViewProps) {
  const [status, setStatus] = useState<StagingStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiffDto | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const busyRef = useRef(false);
  const requestIdRef = useRef(0);
  const onBusyChangeRef = useRef(onBusyChange);
  const onMutatedRef = useRef(onMutated);
  const onExitRef = useRef(onExit);
  onBusyChangeRef.current = onBusyChange;
  onMutatedRef.current = onMutated;
  onExitRef.current = onExit;

  useEffect(() => {
    busyRef.current = busy;
    onBusyChangeRef.current(busy);
  }, [busy]);

  useEffect(() => () => onBusyChangeRef.current(false), []);

  const load = useCallback(async (quiet = false): Promise<StagingStatusDto | null> => {
    if (!quiet) {
      setLoading(true);
    }
    try {
      const next = await ipc.stagingStatus();
      setStatus(next);
      return next;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  const select = useCallback(async (file: StagingFileDto, side: Side) => {
    setSelection({ path: file.path, side });
    const requestId = ++requestIdRef.current;
    setDiff(null);
    setDiffLoading(true);
    try {
      const next = await ipc.readStagingDiff(file.path, side === "staged");
      if (requestId === requestIdRef.current) {
        setDiff(next);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(errorText(err));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setDiffLoading(false);
      }
    }
  }, []);

  // 切换仓库时作废在途请求，避免旧仓库的 diff 落到新仓库界面。
  useEffect(() => {
    requestIdRef.current += 1;
    setStatus(null);
    setSelection(null);
    setDiff(null);
    setDiffLoading(false);
    setChecked({});
    setExpanded(false);
    void load();
  }, [repo.path, load]);

  useEffect(() => {
    if (!status || selection) {
      return;
    }
    if (status.unstaged.length > 0) {
      void select(status.unstaged[0], "unstaged");
    } else if (status.staged.length > 0) {
      void select(status.staged[0], "staged");
    }
  }, [status, selection, select]);

  // 文件经 stage/unstage 或外部操作换边后，清掉失效的选择。
  useEffect(() => {
    if (!status || !selection) {
      return;
    }
    const list = selection.side === "staged" ? status.staged : status.unstaged;
    if (!list.some((file) => file.path === selection.path)) {
      setSelection(null);
      setDiff(null);
    }
  }, [status, selection]);

  // 终端/LazyGit 等外部操作同样会改变 index，只监听并静默重载，不触发写流程。
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    void listen<RepositoryChangedDto>("repository-changed", (event) => {
      if (event.payload.path !== repo.path || busyRef.current) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) {
          void load(true);
        }
      }, 150);
    })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch((err) => setError(`监听仓库变更失败：${errorText(err)}`));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [repo.path, load]);

  // 放大 diff 时 Esc 由 FileDiffView 自己处理；否则退出暂存区视图。
  useEffect(() => {
    if (expanded) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".terminal-panel")) {
        return;
      }
      onExitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const mutate = useCallback(
    async (side: Side, paths: string[]) => {
      if (paths.length === 0 || busyRef.current || writeDisabled) {
        return;
      }
      const kind = side === "unstaged" ? "stage_files" : "unstage_files";
      const previous = selection;
      setBusy(true);
      setError(null);
      try {
        const outcome = await ipc.executeWrite({ kind, paths });
        if (outcome.status === "failed" || outcome.status === "rejected") {
          setError([outcome.message, outcome.stderr].filter(Boolean).join("\n\n"));
          return;
        }
        setChecked({});
        const next = await load(true);
        await onMutatedRef.current(outcome.message);
        if (next) {
          const target: Side = side === "unstaged" ? "staged" : "unstaged";
          const list = target === "staged" ? next.staged : next.unstaged;
          const moved = previous ? list.find((file) => file.path === previous.path) : undefined;
          if (moved) {
            void select(moved, target);
          }
        }
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [load, select, selection, writeDisabled],
  );

  const toggle = (side: Side, path: string) =>
    setChecked((current) => {
      const key = sideKey(side, path);
      const next = { ...current };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });

  const setGroup = (side: Side, files: StagingFileDto[], value: boolean) =>
    setChecked((current) => {
      const next = { ...current };
      for (const file of files) {
        const key = sideKey(side, file.path);
        if (value) {
          next[key] = true;
        } else {
          delete next[key];
        }
      }
      return next;
    });

  const disabled = writeDisabled || busy || loading;

  const renderGroup = (side: Side, title: string, files: StagingFileDto[]) => {
    const selectedPaths = files
      .filter((file) => checked[sideKey(side, file.path)])
      .map((file) => file.path);
    const allChecked = files.length > 0 && selectedPaths.length === files.length;
    const action = side === "unstaged" ? "暂存" : "取消暂存";
    return (
      <section className="staging-group" aria-label={title}>
        <header className="staging-group-head">
          <label className="staging-group-check">
            <input
              type="checkbox"
              checked={allChecked}
              disabled={files.length === 0 || disabled}
              onChange={(event) => setGroup(side, files, event.target.checked)}
              aria-label={`全选${title}文件`}
            />
            <strong>{title}</strong>
          </label>
          <span className="muted">{files.length}</span>
          <div className="staging-group-actions">
            <button
              disabled={selectedPaths.length === 0 || disabled}
              onClick={() => void mutate(side, selectedPaths)}
            >
              {action}所选{selectedPaths.length > 0 ? ` (${selectedPaths.length})` : ""}
            </button>
            <button
              disabled={files.length === 0 || disabled}
              onClick={() => void mutate(side, files.map((file) => file.path))}
            >
              全部{action}
            </button>
          </div>
        </header>
        {files.length === 0 ? (
          <p className="staging-empty muted">
            {side === "staged" ? "没有已暂存的改动" : "没有未暂存的改动"}
          </p>
        ) : (
          <ul className="staging-list">
            {files.map((file) => {
              const active = selection?.path === file.path && selection.side === side;
              return (
                <li key={`${side}:${file.path}`}>
                  <div
                    className={active ? "staging-row active" : "staging-row"}
                    onClick={() => void select(file, side)}
                  >
                    <input
                      className="staging-check"
                      type="checkbox"
                      checked={Boolean(checked[sideKey(side, file.path)])}
                      onChange={() => toggle(side, file.path)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`选择 ${file.path}`}
                    />
                    <span
                      className={`file-status file-status-${file.status}`}
                      title={STATUS_LABEL[file.status]}
                    >
                      {STATUS_LETTER[file.status]}
                    </span>
                    <span className="staging-path mono" title={pathLabel(file)}>
                      {pathLabel(file)}
                    </span>
                    <span className="staging-stats">{fileMeta(file)}</span>
                    <button
                      className="staging-row-action"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        void mutate(side, [file.path]);
                      }}
                    >
                      {action}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  const headLabel = status
    ? status.head.kind === "branch"
      ? status.head.branch ?? "分支"
      : status.head.kind === "detached"
        ? "detached HEAD"
        : "未出生分支"
    : "";

  return (
    <section className="staging-view" aria-label="暂存区">
      <header className="staging-head">
        <div className="staging-head-title">
          <strong>暂存区</strong>
          <span className="tag">{headLabel}</span>
          {status?.unborn && <span className="muted">尚无提交</span>}
          {status?.detached && <span className="muted">detached</span>}
        </div>
        <div className="staging-head-actions">
          {status && (
            <span className="staging-counts muted">
              已暂存 {status.staged.length} · 未暂存 {status.unstaged.length}
              {status.conflicted_files.length > 0
                ? ` · 冲突 ${status.conflicted_files.length}`
                : ""}
            </span>
          )}
          <button onClick={() => void load()} disabled={loading || busy}>
            {loading ? "读取中…" : "刷新"}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner danger compact" role="alert">
          <span className="banner-text">{error}</span>
          <button className="link" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      {status?.warnings.map((warning) => (
        <div className="banner warning compact" key={warning.code}>
          {warning.message}
        </div>
      ))}

      {status?.is_bare ? (
        <div className="placeholder">
          <p className="muted">bare 仓库没有工作区，无法查看暂存状态。</p>
        </div>
      ) : loading && !status ? (
        <div className="placeholder">
          <p className="muted">读取暂存状态…</p>
        </div>
      ) : status ? (
        <div className="staging-body">
          <div className="staging-lists">
            {renderGroup("unstaged", "未暂存", status.unstaged)}
            {renderGroup("staged", "已暂存", status.staged)}
            {status.conflicted_files.length > 0 && (
              <section className="staging-group staging-conflicts" aria-label="冲突文件">
                <header className="staging-group-head">
                  <strong>冲突文件</strong>
                  <span className="muted">{status.conflicted_files.length}</span>
                </header>
                <ul className="staging-list">
                  {status.conflicted_files.map((path) => (
                    <li key={path} className="staging-conflict-row">
                      <span className="file-status file-status-conflicted">U</span>
                      <span className="staging-path mono" title={path}>
                        {path}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="staging-conflict-hint muted">
                  先解决冲突并 git add，再回到暂存区继续；也可在终端中完成。
                </p>
                <button onClick={onOpenTerminal}>打开终端处理冲突</button>
              </section>
            )}
          </div>

          <div className="staging-diff">
            {selection && diff ? (
              <FileDiffView
                diff={diff}
                expanded={expanded}
                onExpandedChange={setExpanded}
                loading={diffLoading}
              />
            ) : (
              <div className="placeholder">
                <p className="muted">
                  {diffLoading ? "正在读取 diff…" : "选择一个文件查看 staged/unstaged diff"}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="placeholder">
          <p className="muted">暂存状态不可用</p>
        </div>
      )}
    </section>
  );
}
