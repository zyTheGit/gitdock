import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeMessage } from "../features/write/messages";
import { errorText, outcomeText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type {
  AppInfoDto,
  CommitSummaryDto,
  GateReportDto,
  RepoStateDto,
  WorkspaceStatusDto,
  WriteKind,
  WriteRequest,
} from "../shared/types";

export type PromptWriteKind = Extract<
  WriteKind,
  "cherry_pick" | "revert" | "switch_branch" | "merge" | "rebase" | "continue_operation" | "abort_operation"
>;
export type InterruptionWriteKind = Extract<WriteKind, "continue_operation" | "abort_operation">;
export type SingleInterruption = "cherry_pick" | "revert" | "merge" | "rebase";

export interface WriteFlowRefLock {
  current: symbol | null;
}

/** 同步占锁：同一 tick 的后续调用在 React 渲染前就会被拒绝。 */
export function acquireWriteFlowLock(lock: WriteFlowRefLock): symbol | null {
  if (lock.current !== null) {
    return null;
  }
  const token = Symbol("write-flow-lock");
  lock.current = token;
  return token;
}

export function releaseWriteFlowLock(lock: WriteFlowRefLock, token: symbol): void {
  if (lock.current === token) {
    lock.current = null;
  }
}

export interface WritePrompt {
  kind: PromptWriteKind;
  commit?: CommitSummaryDto;
  /** 批量 cherry-pick / revert 的目标列表；与 commit 互斥。 */
  commits?: CommitSummaryDto[];
  branch?: string;
  /** 继续/中止对应的中断类型；必须与后端探测结果严格一致。 */
  interruption?: SingleInterruption;
  gate: GateReportDto | null;
  gateError?: string;
}

interface WriteFlowOptions {
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  appBusy: boolean;
  reload: (options?: { keepRows?: boolean }) => Promise<void>;
  readSnapshot: () => Promise<[RepoStateDto, WorkspaceStatusDto]>;
  applySnapshot: (state: RepoStateDto, status: WorkspaceStatusDto) => void;
  setError: (message: string | null) => void;
  setDiagnostic: (text: string | null) => void;
  setToast: (message: string | null) => void;
}

/** 写操作两步流程：先取 Gate 结论展示在确认框中，Gate 通过后才允许执行。 */
export function useWriteFlow({
  repo,
  info,
  appBusy,
  reload,
  readSnapshot,
  applySnapshot,
  setError,
  setDiagnostic,
  setToast,
}: WriteFlowOptions) {
  const [prompt, setPrompt] = useState<WritePrompt | null>(null);
  // 重置（ADR-0029）有独立的模式选择与 Gate 预览，这里只持有目标提交；
  // ResetDialog 自己负责 validate/execute 与写后刷新，避免把模式塞进 WritePrompt。
  const [resetTarget, setResetTarget] = useState<CommitSummaryDto | null>(null);
  const [mainline, setMainline] = useState(1);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const validationLockRef = useRef<symbol | null>(null);
  const validatingCountRef = useRef(0);
  const repoPath = repo?.path ?? null;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  // Gate 请求序号：改选父提交会连发多次检查，只允许最后一次的结论落到确认框。
  const gateSeq = useRef(0);

  useEffect(() => {
    gateSeq.current += 1;
    setPrompt(null);
    setResetTarget(null);
    setValidating(false);
  }, [repoPath]);

  const fetchGate = useCallback(async (request: WriteRequest): Promise<GateReportDto | null> => {
    const seq = ++gateSeq.current;
    validatingCountRef.current += 1;
    setValidating(true);
    try {
      const gate = await ipc.validateWrite(request);
      if (gateSeq.current !== seq) {
        return null;
      }
      setPrompt((current) => (current ? { ...current, gate, gateError: undefined } : current));
      return gate;
    } catch (err) {
      if (gateSeq.current === seq) {
        setPrompt((current) =>
          current ? { ...current, gate: null, gateError: errorText(err) } : current,
        );
      }
      return null;
    } finally {
      validatingCountRef.current -= 1;
      if (validatingCountRef.current === 0) {
        setValidating(false);
      }
    }
  }, []);

  const validatePrompt = useCallback(async (request: WriteRequest): Promise<void> => {
    const gate = await fetchGate(request);
    // merge commit 的 Gate 要求显式 mainline：用默认第 1 父再查一次，让摘要直接显示基线父。
    if (gate?.is_merge_commit) {
      await fetchGate({ ...request, mainline: 1 });
    }
  }, [fetchGate]);

  const start = useCallback(
    async (
      kind: Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch" | "merge" | "rebase">,
      target: { commit?: CommitSummaryDto; branch?: string },
    ) => {
      if (busyRef.current || validationLockRef.current !== null || validatingCountRef.current > 0) {
        return;
      }
      const lock = acquireWriteFlowLock(validationLockRef);
      if (!lock) {
        return;
      }
      try {
        setError(null);
        setDiagnostic(null);
        setMainline(1);
        setPrompt({ kind, ...target, gate: null });
        const request: WriteRequest = { kind, oid: target.commit?.oid, branch: target.branch };
        await validatePrompt(request);
      } finally {
        releaseWriteFlowLock(validationLockRef, lock);
      }
    },
    [setDiagnostic, setError, validatePrompt],
  );

  /** 批量 cherry-pick / revert：oids 顺序即执行顺序。 */
  const startBatch = useCallback(
    async (kind: "cherry_pick" | "revert", commits: CommitSummaryDto[]) => {
      if (
        commits.length < 2 ||
        busyRef.current ||
        validationLockRef.current !== null ||
        validatingCountRef.current > 0
      ) {
        return;
      }
      const lock = acquireWriteFlowLock(validationLockRef);
      if (!lock) {
        return;
      }
      try {
        setError(null);
        setDiagnostic(null);
        setMainline(1);
        setPrompt({ kind, commits, gate: null });
        const request: WriteRequest = { kind, oids: commits.map((commit) => commit.oid) };
        await validatePrompt(request);
      } finally {
        releaseWriteFlowLock(validationLockRef, lock);
      }
    },
    [setDiagnostic, setError, validatePrompt],
  );

  /** 继续/中止没有提交目标，只带中断类型；是否可用仍由 Gate 决定。 */
  const startInterruption = useCallback(
    async (kind: InterruptionWriteKind, interruption: SingleInterruption) => {
      if (busyRef.current || validationLockRef.current !== null || validatingCountRef.current > 0) {
        return;
      }
      const lock = acquireWriteFlowLock(validationLockRef);
      if (!lock) {
        return;
      }
      try {
        setError(null);
        setDiagnostic(null);
        setPrompt({ kind, interruption, gate: null });
        await fetchGate({ kind, interruption });
      } finally {
        releaseWriteFlowLock(validationLockRef, lock);
      }
    },
    [fetchGate, setDiagnostic, setError],
  );

  /** 打开重置确认框：只记录目标提交，模式与 Gate 由 ResetDialog 内部维护。 */
  const startReset = useCallback(
    (commit: CommitSummaryDto) => {
      if (busyRef.current || validationLockRef.current !== null || validatingCountRef.current > 0) {
        return;
      }
      setError(null);
      setDiagnostic(null);
      setResetTarget(commit);
    },
    [setDiagnostic, setError],
  );

  const closeReset = useCallback(() => setResetTarget(null), []);

  const changeMainline = useCallback(
    (next: number) => {
      const value = Number.isInteger(next) && next >= 1 ? next : 1;
      setMainline(value);
      if (!prompt?.gate?.is_merge_commit) {
        return;
      }
      // 改选父提交后必须重跑 Gate，替换显示中的基线摘要。
      void fetchGate({
        kind: prompt.kind,
        oid: prompt.commit?.oid,
        oids: prompt.commits?.map((commit) => commit.oid),
        branch: prompt.branch,
        interruption: prompt.interruption,
        mainline: value,
      });
    },
    [fetchGate, prompt],
  );

  const run = useCallback(async () => {
    if (
      busyRef.current ||
      validationLockRef.current !== null ||
      validatingCountRef.current > 0 ||
      !repoPath ||
      !prompt?.gate?.ok
    ) {
      return;
    }
    const { kind, commit, commits, branch, interruption, gate } = prompt;
    const requestedRepoPath = repoPath;
    const request: WriteRequest = {
      kind,
      oid: commit?.oid,
      oids: commits?.map((item) => item.oid),
      branch,
      interruption,
      // 非 merge commit 不得携带 mainline，否则 Gate 会拒绝。
      mainline: gate.is_merge_commit ? mainline : undefined,
    };
    // 先同步占锁，再触发渲染；同一事件循环内的快速连点也不能重复执行。
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setDiagnostic(null);
    try {
      const outcome = await ipc.executeWrite(request);
      if (repoPathRef.current !== requestedRepoPath) {
        return;
      }
      setPrompt(null);
      setToast(outcomeMessage(kind, outcome, branch, interruption));
      if (outcome.status === "failed") {
        // 切换分支与继续/中止失败时直接展示 stderr，用户需要看到 Git 点名的路径或拒绝原因。
        const showStderr =
          Boolean(outcome.stderr) &&
          (kind === "switch_branch" ||
            kind === "continue_operation" ||
            kind === "abort_operation" ||
            kind === "merge" ||
            kind === "rebase");
        const headline = outcomeText(outcome);
        setError(showStderr ? `${headline}\n\n${outcome.stderr!.trim()}` : headline);
        setDiagnostic(outcome.stderr ?? headline);
      }
      if (outcome.status !== "rejected") {
        const [state, status] = await readSnapshot();
        // generation 是 refs/HEAD 指纹（随机 64 位），不具备单调性，不能做大小比较；
        // 写后状态是重新探测的，只需确认仓库未被切换，避免旧仓库结果覆盖新界面。
        if (!repoPath || state.path === repoPath) {
          applySnapshot(state, status);
          await reload({ keepRows: true });
        }
      }
    } catch (err) {
      if (repoPathRef.current === requestedRepoPath) {
        setPrompt(null);
        setError(errorText(err));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [prompt, mainline, repoPath, readSnapshot, applySnapshot, reload, setDiagnostic, setError, setToast]);

  const cancel = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    // 允许在 Gate 检查中取消：立即使旧结论失效，占锁由 start 的 finally 释放。
    gateSeq.current += 1;
    setPrompt(null);
    setValidating(false);
  }, []);

  const disabled =
    appBusy ||
    busy ||
    !repo ||
    repo.is_bare ||
    repo.interruption.kinds.length > 0 ||
    !info?.git_version_supported;
  // 普通写操作在中断态仍然禁用；继续/中止是解除中断态的唯一入口，因此不受该条件限制。
  const interruptionDisabled =
    appBusy || busy || !repo || repo.is_bare || !info?.git_version_supported;

  // 右键菜单的写动作集合：App 组装菜单时整体展开，避免逐项传参。
  const menuWriteActions = {
    onCherryPick: (commit: CommitSummaryDto) => void start("cherry_pick", { commit }),
    onRevert: (commit: CommitSummaryDto) => void start("revert", { commit }),
    onBatchCherryPick: (commits: CommitSummaryDto[]) => void startBatch("cherry_pick", commits),
    onBatchRevert: (commits: CommitSummaryDto[]) => void startBatch("revert", commits),
    onMergeBranch: (branch: string) => void start("merge", { branch }),
    onRebaseBranch: (branch: string) => void start("rebase", { branch }),
    onResetHere: startReset,
  };

  return {
    prompt,
    resetTarget,
    closeReset,
    menuWriteActions,
    busy,
    validating,
    mainline,
    start,
    startBatch,
    startInterruption,
    changeMainline,
    run,
    cancel,
    disabled,
    interruptionDisabled,
  };
}
