import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../../i18n";
import { FileDiffView } from "../diff/FileDiffView";
import { isEscConsumed, isEventInTerminal } from "../../shared/esc";
import { errorText, outcomeText, warningText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  FileDiffDto,
  RepoStateDto,
  RepositoryChangedDto,
  StagingFileDto,
  StagingStatusDto,
} from "../../shared/types";
import { StagingFileList, sideKey, type Side } from "./StagingFileList";
import { CommitMessageDialog } from "./CommitMessageDialog";

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


export function StagingView({
  repo,
  writeDisabled,
  onBusyChange,
  onMutated,
  onOpenTerminal,
  onExit,
}: StagingViewProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<StagingStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiffDto | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [commitOpen, setCommitOpen] = useState(false);

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
    setCommitOpen(false);
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
      .catch((err) => setError(`${t("staging.watchFailedPrefix")}${errorText(err)}`));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [repo.path, load]);

  // Esc 退出暂存区视图；放大 diff 已在捕获阶段消费的 Esc，以及终端聚焦时的
  // Esc 归终端程序，均让路。监听常驻、经 ref 读回调，无需按 expanded 重装。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (isEscConsumed(event)) {
        return;
      }
      if (isEventInTerminal(event)) {
        return;
      }
      onExitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          setError([outcomeText(outcome), outcome.stderr].filter(Boolean).join("\n\n"));
          return;
        }
        setChecked({});
        const next = await load(true);
        await onMutatedRef.current(outcomeText(outcome));
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

  // 提交成功：先重读暂存状态（对话框由 CommitMessageDialog 自行关闭），再走
  // 既有 mutate 通道（toast + 快照 + 图谱刷新），generation 语义与 stage/unstage 一致。
  const commitCommitted = useCallback(
    async (message: string) => {
      setChecked({});
      await load(true);
      await onMutatedRef.current(message);
    },
    [load],
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

    const allLabel = side === "unstaged" ? t("staging.stageAll") : t("staging.unstageAll");
    const selectAllLabel =
      side === "unstaged" ? t("staging.selectAllUnstagedFiles") : t("staging.selectAllStagedFiles");
    const selectedLabel =
      side === "unstaged"
        ? selectedPaths.length > 0
          ? t("staging.stageSelectedCount", { n: selectedPaths.length })
          : t("staging.stageSelected")
        : selectedPaths.length > 0
          ? t("staging.unstageSelectedCount", { n: selectedPaths.length })
          : t("staging.unstageSelected");
    return (
      <section className="staging-group" aria-label={title}>
        <header className="staging-group-head">
          <label className="staging-group-check">
            <input
              type="checkbox"
              checked={allChecked}
              disabled={files.length === 0 || disabled}
              onChange={(event) => setGroup(side, files, event.target.checked)}
              aria-label={selectAllLabel}
            />
            <strong>{title}</strong>
          </label>
          <span className="muted">{files.length}</span>
          <div className="staging-group-actions">
            <button
              disabled={selectedPaths.length === 0 || disabled}
              onClick={() => void mutate(side, selectedPaths)}
            >
              {selectedLabel}
            </button>
            <button
              disabled={files.length === 0 || disabled}
              onClick={() => void mutate(side, files.map((file) => file.path))}
            >
              {allLabel}
            </button>
          </div>
        </header>
        {files.length === 0 ? (
          <p className="staging-empty muted">
            {side === "staged" ? t("staging.emptyStaged") : t("staging.emptyUnstaged")}
          </p>
        ) : (
          <StagingFileList
            side={side}
            files={files}
            activePath={selection?.side === side ? selection.path : null}
            checked={checked}
            disabled={disabled}
            onSelect={(file, fileSide) => void select(file, fileSide)}
            onToggleCheck={toggle}
            onRowAction={(fileSide, path) => void mutate(fileSide, [path])}
          />
        )}
      </section>
    );
  };

  const headLabel = status
    ? status.head.kind === "branch"
      ? status.head.branch ?? t("staging.branchFallback")
      : status.head.kind === "detached"
        ? "detached HEAD"
        : t("staging.unbornBranch")
    : "";

  return (
    <section className="staging-view" aria-label={t("staging.viewLabel")}>
      <header className="staging-head">
        <div className="staging-head-title">
          <strong>{t("staging.title")}</strong>
          <span className="tag">{headLabel}</span>
          {status?.unborn && <span className="muted">{t("staging.noCommitsYet")}</span>}
          {status?.detached && <span className="muted">detached</span>}
        </div>
        <div className="staging-head-actions">
          {status && (
            <span className="staging-counts muted">
              {[
                t("staging.countStaged", { n: status.staged.length }),
                t("staging.countUnstaged", { n: status.unstaged.length }),
                ...(status.conflicted_files.length > 0
                  ? [t("staging.countConflicted", { n: status.conflicted_files.length })]
                  : []),
              ].join(" · ")}
            </span>
          )}
          <button
            className="primary"
            disabled={
              disabled ||
              status === null ||
              status.conflicted_files.length > 0 ||
              (status.staged.length === 0 && !status.unborn)
            }
            onClick={() => setCommitOpen(true)}
          >
            {t("staging.openCommitDialog")}
          </button>
          <button onClick={() => void load()} disabled={loading || busy}>
            {loading ? t("staging.loading") : t("staging.refresh")}
          </button>
        </div>
      </header>

      {commitOpen && status && (
        <CommitMessageDialog
          unborn={status.unborn}
          onCancel={() => setCommitOpen(false)}
          onCommitted={commitCommitted}
        />
      )}

      {error && (
        <div className="banner danger compact" role="alert">
          <span className="banner-text">{error}</span>
          <button className="link" onClick={() => setError(null)}>
            {t("staging.close")}
          </button>
        </div>
      )}

      {status?.warnings.map((warning) => (
        <div className="banner warning compact" key={warning.code}>
          {warningText(warning)}
        </div>
      ))}

      {status?.is_bare ? (
        <div className="placeholder">
          <p className="muted">{t("staging.bareRepoHint")}</p>
        </div>
      ) : loading && !status ? (
        <div className="placeholder">
          <p className="muted">{t("staging.loadingStatus")}</p>
        </div>
      ) : status ? (
        <div className="staging-body">
          <div className="staging-lists">
            {renderGroup("unstaged", t("staging.groupUnstaged"), status.unstaged)}
            {renderGroup("staged", t("staging.groupStaged"), status.staged)}
            {status.conflicted_files.length > 0 && (
              <section className="staging-group staging-conflicts" aria-label={t("staging.conflictFiles")}>
                <header className="staging-group-head">
                  <strong>{t("staging.conflictFiles")}</strong>
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
                <p className="staging-conflict-hint muted">{t("staging.conflictHint")}</p>
                <button onClick={onOpenTerminal}>{t("staging.openTerminalForConflicts")}</button>
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
                  {diffLoading ? t("staging.readingDiff") : t("staging.diffPlaceholder")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="placeholder">
          <p className="muted">{t("staging.statusUnavailable")}</p>
        </div>
      )}
    </section>
  );
}
