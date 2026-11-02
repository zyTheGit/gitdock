import { useCallback, useRef, useState } from "react";
import { outcomeMessage } from "../features/write/messages";
import { errorText } from "../shared/error";
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
  "cherry_pick" | "revert" | "switch_branch" | "continue_operation" | "abort_operation"
>;
export type InterruptionWriteKind = Extract<WriteKind, "continue_operation" | "abort_operation">;
export type SingleInterruption = "cherry_pick" | "revert";

export interface WritePrompt {
  kind: PromptWriteKind;
  commit?: CommitSummaryDto;
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
  const [mainline, setMainline] = useState(1);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Gate 请求序号：改选父提交会连发多次检查，只允许最后一次的结论落到确认框。
  const gateSeq = useRef(0);

  const fetchGate = useCallback(async (request: WriteRequest): Promise<GateReportDto | null> => {
    const seq = ++gateSeq.current;
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
      // 只有最新一次请求负责收尾，较早的请求不能把「检查中」提前关掉。
      if (gateSeq.current === seq) {
        setValidating(false);
      }
    }
  }, []);

  const start = useCallback(
    async (
      kind: Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch">,
      target: { commit?: CommitSummaryDto; branch?: string },
    ) => {
      setError(null);
      setDiagnostic(null);
      setMainline(1);
      setPrompt({ kind, ...target, gate: null });
      const request: WriteRequest = { kind, oid: target.commit?.oid, branch: target.branch };
      const gate = await fetchGate(request);
      // merge commit 的 Gate 要求显式 mainline：用默认第 1 父再查一次，让摘要直接显示基线父。
      if (gate?.is_merge_commit) {
        await fetchGate({ ...request, mainline: 1 });
      }
    },
    [fetchGate, setDiagnostic, setError],
  );

  /** 继续/中止没有提交目标，只带中断类型；是否可用仍由 Gate 决定。 */
  const startInterruption = useCallback(
    async (kind: InterruptionWriteKind, interruption: SingleInterruption) => {
      setError(null);
      setDiagnostic(null);
      setPrompt({ kind, interruption, gate: null });
      await fetchGate({ kind, interruption });
    },
    [fetchGate, setDiagnostic, setError],
  );

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
        branch: prompt.branch,
        interruption: prompt.interruption,
        mainline: value,
      });
    },
    [fetchGate, prompt],
  );

  const run = useCallback(async () => {
    if (!prompt?.gate?.ok) {
      return;
    }
    const { kind, commit, branch, interruption, gate } = prompt;
    const repoPath = repo?.path;
    const request: WriteRequest = {
      kind,
      oid: commit?.oid,
      branch,
      interruption,
      // 非 merge commit 不得携带 mainline，否则 Gate 会拒绝。
      mainline: gate.is_merge_commit ? mainline : undefined,
    };
    setBusy(true);
    setError(null);
    setDiagnostic(null);
    try {
      const outcome = await ipc.executeWrite(request);
      setPrompt(null);
      setToast(outcomeMessage(kind, outcome, branch, interruption));
      if (outcome.status === "failed") {
        // 切换分支与继续/中止失败时直接展示 stderr，用户需要看到 Git 点名的路径或拒绝原因。
        const showStderr =
          Boolean(outcome.stderr) &&
          (kind === "switch_branch" || kind === "continue_operation" || kind === "abort_operation");
        setError(showStderr ? `${outcome.message}\n\n${outcome.stderr!.trim()}` : outcome.message);
        setDiagnostic(outcome.stderr ?? outcome.message);
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
      setPrompt(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, mainline, repo?.path, readSnapshot, applySnapshot, reload, setDiagnostic, setError, setToast]);

  const cancel = useCallback(() => {
    if (!busyRef.current) {
      setPrompt(null);
    }
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

  return {
    prompt,
    busy,
    validating,
    mainline,
    start,
    startInterruption,
    changeMainline,
    run,
    cancel,
    disabled,
    interruptionDisabled,
  };
}
