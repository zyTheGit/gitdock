import { useCallback, useMemo, useRef, useState } from "react";
import { publishOperationNotice, writeErrorNotice, writeOutcomeNotice } from "../../app/operationNotice";
import { useI18n } from "../../i18n";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  FileDiffDto,
  GateIssueDto,
  GateReportDto,
  StagingStatusDto,
  WarningDto,
  WriteRequest,
} from "../../shared/types";
import type { HunkActionsConfig } from "../diff/HunkActions";
import type { Side } from "./StagingFileList";

/** 暂存区当前选中的文件与列别（与 StagingView 的 Selection 同构）。 */
export interface HunkSelection {
  path: string;
  side: Side;
}

/** 待确认丢弃的单块目标；dialog 用 1 起始序号展示。 */
export interface HunkDiscardTarget {
  path: string;
  /** 0 起始的 hunk 序号，即后端请求里的 hunk_index。 */
  index: number;
  /** 1 起始的展示序号。 */
  ordinal: number;
  total: number;
}

/** 一次操作结束后静默重读状态与当前文件 diff 的入口（由 StagingView 提供）。 */
export interface HunkFlowOptions {
  /** 当前仓库路径；旧仓库异步结果不得回写或发布通知。 */
  repoPath: string;
  /** 写互斥 / 加载中：不接受新的 hunk 请求。 */
  disabled: boolean;
  selection: HunkSelection | null;
  /** 当前渲染的 diff；用于统计块总数（dialog 展示「第 n 块 / 共 m 块」）。 */
  diff: FileDiffDto | null;
  /** 已有写操作在跑。 */
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /** 静默重读暂存状态（返回最新列表，供判断选择是否仍然有效）。 */
  reload: () => Promise<StagingStatusDto | null>;
  /** 重读同一文件同一侧的 diff（走既有 select，保持 requestId 语义）。 */
  reloadDiff: (path: string, side: Side) => Promise<void>;
  /** 成功后清空勾选。 */
  clearChecked: () => void;
  /** 成功后的统一收尾：toast + 工作区快照 + 图谱刷新。 */
  onMutated: (message: string) => Promise<void>;
}

export interface HunkFlow {
  /** 传给 FileDiffView 的 hunk 操作回调；未选文件时为空对象（不渲染按钮）。 */
  hunkActions: HunkActionsConfig;
  /** 任一 hunk 操作进行中（按钮级 loading 由按钮组件自己维护）。 */
  running: boolean;
  /** 待确认丢弃的目标；非 null 表示破坏性确认框打开。 */
  confirmingDiscard: HunkDiscardTarget | null;
  confirmDiscard: () => Promise<void>;
  cancelDiscard: () => void;
  /** Gate 拒绝原因（丢弃流程在对话框内展示）。 */
  gateIssues: GateIssueDto[] | null;
  /** Gate 警告（`hunk_discard_destructive` 等）。 */
  gateWarnings: WarningDto[] | null;
  discardError: string | null;
  discardValidating: boolean;
  discardBusy: boolean;
}

/** patch 中 `@@` 头部的数量；与后端按字节切块的结果一致。 */
function countHunks(patch: string | undefined): number {
  if (!patch) {
    return 0;
  }
  let total = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      total += 1;
    }
  }
  return total;
}

/**
 * hunk 操作是否可用：未选文件、二进制 / 过大 / 截断 / 子模块、冲突索引、
 * 未跟踪文件（无 index 基准）以及重命名都不能做 hunk 级操作（ADR 0027 §2.4）。
 */
export function hunkActionsAllowed(
  selection: HunkSelection | null,
  diff: FileDiffDto | null,
  status: StagingStatusDto | null,
): boolean {
  if (!selection || !diff) {
    return false;
  }
  if (diff.binary || diff.too_large || diff.gitlink || diff.truncated) {
    return false;
  }
  if ((status?.conflicted_files.length ?? 0) > 0) {
    return false;
  }
  const list = selection.side === "staged" ? status?.staged : status?.unstaged;
  const entry = list?.find((file) => file.path === selection.path);
  if (!entry || entry.untracked || entry.binary || entry.gitlink) {
    return false;
  }
  return !entry.old_path || entry.old_path === entry.path;
}

/**
 * hunk 级暂存 / 取消暂存 / 丢弃的编排（ADR 0027）：每次操作都是一次
 * validate_write + execute_write，补丁与块序号全部由服务端按实时 diff 生成。
 * 丢弃额外走破坏性确认框；任何失败或漂移都重新读取 diff，让块序号与按钮重新对齐。
 */
export function useHunkFlow(options: HunkFlowOptions): HunkFlow {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState<HunkDiscardTarget | null>(null);
  const [gateIssues, setGateIssues] = useState<GateIssueDto[] | null>(null);
  const [gateWarnings, setGateWarnings] = useState<WarningDto[] | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [discardValidating, setDiscardValidating] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);

  // 回调经 ref 读取，避免上层每次渲染的新闭包导致 hook 重建。
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runningRef = useRef(false);

  /** Gate 拒绝文案；越界（看 diff 期间块数漂移）附一句「已重新读取」提示。 */
  const gateText = useCallback(
    (report: GateReportDto) =>
      [
        ...report.issues.map((issue) => issueText(issue)),
        ...(report.issues.some((issue) => issue.code === "gate_hunk_index_out_of_range")
          ? [t("staging.hunkStaleHint")]
          : []),
      ].join("\n"),
    [t],
  );

  /**
   * 操作结束后对齐 UI：静默重读状态，再按最新列表判断是否需要重读当前 diff。
   * 文件已不在该侧时不动 diff —— 选择由 StagingView 的 status 副作用清空并自动换文件。
   */
  const settle = useCallback(async (path: string, side: Side, repoPath: string) => {
    const { reload, reloadDiff } = optionsRef.current;
    const next = await reload();
    if (optionsRef.current.repoPath !== repoPath) {
      return;
    }
    const current = optionsRef.current.selection;
    if (!next || !current || current.path !== path || current.side !== side) {
      return;
    }
    const list = side === "staged" ? next.staged : next.unstaged;
    if (list.some((file) => file.path === path)) {
      await reloadDiff(path, side);
    }
  }, []);

  /** 暂存 / 取消暂存单块：无破坏性，直接 validate → execute。 */
  const runHunk = useCallback(
    async (kind: "stage_hunk" | "unstage_hunk", index: number) => {
      const opts = optionsRef.current;
      const selection = opts.selection;
      if (!selection || runningRef.current || opts.disabled || opts.isBusy()) {
        return;
      }
      const { path, side } = selection;
      const repoPath = opts.repoPath;
      const request: WriteRequest = { kind, path, hunk_index: index };
      runningRef.current = true;
      setRunning(true);
      opts.setBusy(true);
      opts.setError(null);
      try {
        const report = await ipc.validateWrite(request);
        if (optionsRef.current.repoPath !== repoPath) {
          return;
        }
        if (!report.ok) {
          const message = gateText(report);
          opts.setError(message);
          publishOperationNotice(writeErrorNotice(kind, message), repoPath);
          await settle(path, side, repoPath);
          return;
        }
        const outcome = await ipc.executeWrite(request);
        if (optionsRef.current.repoPath !== repoPath) {
          return;
        }
        if (outcome.status !== "succeeded") {
          const message = outcomeText(outcome);
          opts.setError(message);
          publishOperationNotice(
            writeOutcomeNotice(kind, outcome, { summary: message }),
            repoPath,
          );
          await settle(path, side, repoPath);
          return;
        }
        const message = outcomeText(outcome);
        publishOperationNotice(writeOutcomeNotice(kind, outcome), repoPath);
        opts.clearChecked();
        await settle(path, side, repoPath);
        if (optionsRef.current.repoPath === repoPath) {
          await opts.onMutated(message);
        }
      } catch (err) {
        if (optionsRef.current.repoPath === repoPath) {
          const message = errorText(err);
          opts.setError(message);
          publishOperationNotice(writeErrorNotice(kind, message), repoPath);
        }
        await settle(path, side, repoPath);
      } finally {
        runningRef.current = false;
        setRunning(false);
        opts.setBusy(false);
      }
    },
    [gateText, settle],
  );

  /** 打开丢弃确认框：不执行任何 Git 操作，等用户在框内确认。 */
  const openDiscard = useCallback((index: number) => {
    const opts = optionsRef.current;
    if (!opts.selection || runningRef.current || opts.disabled || opts.isBusy()) {
      return;
    }
    const ordinal = index + 1;
    setConfirmingDiscard({
      path: opts.selection.path,
      index,
      ordinal,
      total: Math.max(countHunks(opts.diff?.patch), ordinal),
    });
    setGateIssues(null);
    setGateWarnings(null);
    setDiscardError(null);
  }, []);

  const cancelDiscard = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    setConfirmingDiscard(null);
    setGateIssues(null);
    setGateWarnings(null);
    setDiscardError(null);
  }, []);

  /** 确认后：Gate → 执行；只在成功后关闭对话框并走与 stage/unstage 相同的收尾。 */
  const confirmDiscard = useCallback(async () => {
    const opts = optionsRef.current;
    if (!confirmingDiscard || runningRef.current || opts.disabled || opts.isBusy()) {
      return;
    }
    const { path, index } = confirmingDiscard;
    const repoPath = opts.repoPath;
    const request: WriteRequest = { kind: "discard_hunk", path, hunk_index: index };
    runningRef.current = true;
    setRunning(true);
    setDiscardValidating(true);
    opts.setBusy(true);
    opts.setError(null);
    setGateIssues(null);
    setGateWarnings(null);
    setDiscardError(null);
    try {
      const report = await ipc.validateWrite(request);
      if (optionsRef.current.repoPath !== repoPath) {
        return;
      }
      setGateWarnings(report.warnings);
      if (!report.ok) {
        const message = gateText(report);
        setGateIssues(report.issues);
        publishOperationNotice(writeErrorNotice("discard_hunk", message), repoPath);
        // 越界意味着看 diff 期间块数已漂移：立即重读，让对话框背后的序号重新对齐。
        await settle(path, "unstaged", repoPath);
        return;
      }
      setDiscardValidating(false);
      setDiscardBusy(true);
      const outcome = await ipc.executeWrite(request);
      if (optionsRef.current.repoPath !== repoPath) {
        return;
      }
      if (outcome.status !== "succeeded") {
        const message = outcomeText(outcome);
        setDiscardError(message);
        publishOperationNotice(
          writeOutcomeNotice("discard_hunk", outcome, { summary: message }),
          repoPath,
        );
        await settle(path, "unstaged", repoPath);
        return;
      }
      const message = outcomeText(outcome);
      publishOperationNotice(writeOutcomeNotice("discard_hunk", outcome), repoPath);
      opts.clearChecked();
      await settle(path, "unstaged", repoPath);
      if (optionsRef.current.repoPath !== repoPath) {
        return;
      }
      await opts.onMutated(message);
      if (optionsRef.current.repoPath === repoPath) {
        setConfirmingDiscard(null);
        setGateWarnings(null);
      }
    } catch (err) {
      if (optionsRef.current.repoPath === repoPath) {
        const message = errorText(err);
        setDiscardError(message);
        publishOperationNotice(writeErrorNotice("discard_hunk", message), repoPath);
      }
      await settle(path, "unstaged", repoPath);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setDiscardValidating(false);
      setDiscardBusy(false);
      opts.setBusy(false);
    }
  }, [confirmingDiscard, settle]);

  const side = options.selection?.side;
  const hunkActions = useMemo<HunkActionsConfig>(
    () => ({
      onStage: side === "unstaged" ? (index: number) => runHunk("stage_hunk", index) : undefined,
      onUnstage: side === "staged" ? (index: number) => runHunk("unstage_hunk", index) : undefined,
      onDiscard: side === "unstaged" ? openDiscard : undefined,
      disabled: options.disabled || running,
    }),
    [side, options.disabled, running, runHunk, openDiscard],
  );

  return {
    hunkActions,
    running,
    confirmingDiscard,
    confirmDiscard,
    cancelDiscard,
    gateIssues,
    gateWarnings,
    discardError,
    discardValidating,
    discardBusy,
  };
}
