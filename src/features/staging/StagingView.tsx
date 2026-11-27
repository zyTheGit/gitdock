import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../../i18n";
import { useIgnoreWhitespace } from "../diff/diffOptions";
import { isEscConsumed, isEventInBottomPanel } from "../../shared/esc";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  FileDiffDto,
  RepoId,
  RepoStateDto,
  RepositoryChangedDto,
  StagingStatusDto,
} from "../../shared/types";
import { useFileListMode } from "../../shared/useFileListMode";
import { sideKey, type Side } from "./StagingFileList";
import { StagingBody } from "./StagingBody";
import { StagingDialogs, type FileMenuState } from "./StagingDialogs";
import { StagingHeader } from "./StagingHeader";
import { useDiscardFlow } from "./useDiscardFlow";
import { hunkActionsAllowed, useHunkFlow, type HunkSelection } from "./useHunkFlow";
import type {
  StagingActionBridgeRef,
  StagingActionSelection,
} from "./stagingActionBridge";

type Selection = HunkSelection;

interface StagingViewProps {
  repo: RepoStateDto;
  /** 活动标签 id：仓库变更事件按 repo_id 过滤，避免其他标签的变更触发本视图重载。 */
  repoId?: RepoId | null;
  /** 与写操作共用互斥：应用忙碌、中断态、bare 或 Git 版本不支持时禁用。 */
  writeDisabled: boolean;
  /** 冲突解决三件套的禁用条件：中断态内仍可执行，只是同样受忙碌 / bare / 版本限制（ADR-0033）。 */
  conflictWriteDisabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onMutated: (message: string) => Promise<void>;
  onOpenStash: () => void;
  onOpenTerminal: () => void;
  onExit: () => void;
  actionHandlersRef: StagingActionBridgeRef;
  onSelectionChange?: (selection: StagingActionSelection | null) => void;
}


export function StagingView({
  repo,
  repoId = null,
  writeDisabled,
  conflictWriteDisabled,
  onBusyChange,
  onMutated,
  onOpenStash,
  onOpenTerminal,
  onExit,
  actionHandlersRef,
  onSelectionChange,
}: StagingViewProps) {
  const { t } = useI18n();
  const [fileListMode, setFileListMode] = useFileListMode();
  const [status, setStatus] = useState<StagingStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiffDto | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<FileMenuState | null>(null);
  const [ignoreWhitespace] = useIgnoreWhitespace();

  const busyRef = useRef(false);
  const requestIdRef = useRef(0);
  const onBusyChangeRef = useRef(onBusyChange);
  const onMutatedRef = useRef(onMutated);
  const onExitRef = useRef(onExit);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onBusyChangeRef.current = onBusyChange;
  onMutatedRef.current = onMutated;
  onExitRef.current = onExit;
  onSelectionChangeRef.current = onSelectionChange;

  // ref 与父级互斥同步更新，不能等 busy state 的 effect 落地。
  const setBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    onBusyChangeRef.current(value);
    setBusyState(value);
  }, []);

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

  const select = useCallback(async (target: Selection) => {
    setSelection(target);
    const requestId = ++requestIdRef.current;
    setDiff(null);
    setDiffLoading(true);
    try {
      const next = await ipc.readStagingDiff(
        target.path,
        target.side === "staged",
        ignoreWhitespace,
      );
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
  }, [ignoreWhitespace]);

  // 原地重读当前文件 diff（hunk 操作后对齐块序号）：不清空旧 diff，避免整块视图闪一下。
  const refreshDiff = useCallback(async (path: string, side: Side) => {
    const requestId = ++requestIdRef.current;
    try {
      const next = await ipc.readStagingDiff(path, side === "staged", ignoreWhitespace);
      if (requestId === requestIdRef.current) {
        setDiff(next);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(errorText(err));
      }
    }
  }, [ignoreWhitespace]);

  // 忽略空白是展示参数：切换后按当前选择重读，块序号仍由后端实时生成。
  useEffect(() => {
    if (selection) {
      void refreshDiff(selection.path, selection.side);
    }
  }, [ignoreWhitespace, refreshDiff]);

  // 丢弃未暂存改动（ADR 0026）：确认框 → Gate → 执行，成功路径与 mutate 一致。
  const discard = useDiscardFlow({
    repoPath: repo.path,
    disabled: writeDisabled,
    isBusy: () => busyRef.current,
    setBusy,
    setError,
    reload: () => load(true),
    clearChecked: () => setChecked({}),
    onMutated: (message) => onMutatedRef.current(message),
  });

  // hunk 级暂存 / 取消暂存 / 丢弃（ADR 0027）：块序号与后端 hunk_index 同源，
  // 操作后静默重读状态与 diff，让按钮重新对齐；丢弃走破坏性确认框。
  const hunk = useHunkFlow({
    repoPath: repo.path,
    disabled: writeDisabled || loading || busy,
    selection,
    diff,
    isBusy: () => busyRef.current,
    setBusy,
    setError,
    reload: () => load(true),
    reloadDiff: (path, side) => refreshDiff(path, side),
    clearChecked: () => setChecked({}),
    onMutated: (message) => onMutatedRef.current(message),
  });

  useEffect(() => {
    onSelectionChangeRef.current?.(selection);
  }, [selection]);

  useEffect(() => () => onSelectionChangeRef.current?.(null), []);

  // 切换仓库时作废在途请求，避免旧仓库的 diff 落到新仓库界面。
  useEffect(() => {
    requestIdRef.current += 1;
    setStatus(null);
    setSelection(null);
    setDiff(null);
    setDiffLoading(false);
    setChecked({});
    setExpanded(false);
    setMenu(null);
    discard.cancel();
    hunk.cancelDiscard();
    void load();
  }, [repo.path, load, discard.cancel, hunk.cancelDiscard]);

  useEffect(() => {
    if (!status || selection) {
      return;
    }
    if (status.unstaged.length > 0) {
      void select({ path: status.unstaged[0].path, side: "unstaged" });
    } else if (status.staged.length > 0) {
      void select({ path: status.staged[0].path, side: "staged" });
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
      if (repoId !== null && event.payload.repo_id !== repoId) {
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
      if (isEventInBottomPanel(event)) {
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
            void select({ path: moved.path, side: target });
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

  useEffect(() => {
    const handlers = {
      refresh: () => void load(),
      stageFile: (path: string) => void mutate("unstaged", [path]),
      unstageFile: (path: string) => void mutate("staged", [path]),
      discardFile: (path: string) => discard.open([path]),
    };
    actionHandlersRef.current = handlers;
    return () => {
      if (actionHandlersRef.current === handlers) {
        actionHandlersRef.current = null;
      }
    };
  }, [actionHandlersRef, discard.open, load, mutate, repo.path]);

  // 提交成功：先重读暂存状态（表单由 CommitComposer 自行清空草稿），再走
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

  const setGroup = (side: Side, paths: string[], value: boolean) =>
    setChecked((current) => {
      const next = { ...current };
      for (const path of paths) {
        const key = sideKey(side, path);
        if (value) {
          next[key] = true;
        } else {
          delete next[key];
        }
      }
      return next;
    });

  const disabled = writeDisabled || busy || loading;
  const conflictDisabled = conflictWriteDisabled || busy || loading;
  // 未跟踪 / 冲突索引 / 二进制 / 过大 / 截断 / 子模块 / 重命名文件不提供 hunk 写入口，
  // 与后端 Gate 的拒绝条件一致。
  const hunkEligible = hunkActionsAllowed(selection, diff, status);

  const openFileMenu = (event: ReactMouseEvent, side: Side, path: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, side, path });
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
      <StagingHeader
        status={status}
        disabled={disabled}
        loading={loading}
        busy={busy}
        error={error}
        headLabel={headLabel}
        onClearError={() => setError(null)}
        onOpenStash={onOpenStash}
        onRefresh={() => void load()}
      />
      <StagingBody
        status={status}
        loading={loading}
        repo={repo}
        disabled={disabled}
        conflictDisabled={conflictDisabled}
        checked={checked}
        selection={selection}
        fileListMode={fileListMode}
        onFileListModeChange={setFileListMode}
        busyRef={busyRef}
        setBusy={setBusy}
        setError={setError}
        reload={() => load(true)}
        onMutated={(message) => onMutatedRef.current(message)}
        onOpenTerminal={onOpenTerminal}
        commitCommitted={commitCommitted}
        onMutate={(side, paths) => void mutate(side, paths)}
        onSelect={(file, fileSide) => void select({ path: file.path, side: fileSide })}
        onOpenDiscard={discard.open}
        onToggleCheck={toggle}
        onToggleCheckGroup={setGroup}
        onOpenFileMenu={openFileMenu}
        diff={diff}
        diffLoading={diffLoading}
        expanded={expanded}
        onExpandedChange={setExpanded}
        hunkActions={hunkEligible ? hunk.hunkActions : undefined}
      />
      <StagingDialogs
        menu={menu}
        status={status}
        headOid={repo.head.kind === "unborn" ? null : repo.head.oid ?? null}
        writeDisabled={disabled}
        onCloseMenu={() => setMenu(null)}
        onMutate={(side, paths) => void mutate(side, paths)}
        onOpenDiscard={discard.open}
        onError={setError}
        discard={discard}
        hunk={hunk}
        onOpenStash={onOpenStash}
      />
    </section>
  );
}
