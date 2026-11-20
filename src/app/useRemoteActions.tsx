import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { remoteNamesFromRefs } from "../features/repository/remotes";
import { errorText, issueText, outcomeText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type {
  GateIssueDto,
  PullMode,
  RemoteSyncKind,
  RepoStateDto,
  WriteRequest,
} from "../shared/types";

interface UseRemoteActionsParams {
  repo: RepoStateDto | null;
  writeDisabled: boolean;
  onMutated: (message: string) => Promise<void>;
}

/** 首次推送确认框的目标：当前本地分支 + 已配置的 remote（ADR-0028）。 */
export interface UpstreamPrompt {
  branch: string;
  remotes: string[];
}

export interface RemoteActions {
  disabled: boolean;
  busy: RemoteSyncKind | null;
  error: string | null;
  clearError: () => void;
  pullMode: PullMode;
  setPullMode: (mode: PullMode) => void;
  run: (kind: RemoteSyncKind) => void;
  /** push 因「没有上游」被拒时的替代流程；非 null 时展示设置上游确认框。 */
  upstream: UpstreamPrompt | null;
  closeUpstream: () => void;
}

/** fetch / pull / push 的直执入口（ADR 0010）；唯一例外是 push 缺上游时转入确认框（ADR-0028）。 */
export function useRemoteActions({ repo, writeDisabled, onMutated }: UseRemoteActionsParams) {
  const [busy, setBusy] = useState<RemoteSyncKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pullMode, setPullMode] = useState<PullMode>("ff_only");
  const [upstream, setUpstream] = useState<UpstreamPrompt | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy !== null;

  const repoPath = repo?.path ?? null;
  const branch = repo && repo.head.kind === "branch" ? repo.head.branch ?? null : null;
  const remotes = useMemo(() => remoteNamesFromRefs(repo?.refs ?? []), [repo?.refs]);
  const closeUpstream = useCallback(() => setUpstream(null), []);

  const clearError = useCallback(() => setError(null), []);

  // 切换仓库时清掉旧仓库的远程报错与待确认流程，避免横幅跨仓库残留。
  useEffect(() => {
    setError(null);
    setUpstream(null);
  }, [repoPath]);

  /**
   * 只有「唯一阻塞原因是没有上游」且当前在本地分支、仓库有远程时才转入设置上游流程；
   * 其余拒绝原因（detached / unborn / 无远程等）保持原有报错行为。
   */
  const upstreamPrompt = useCallback(
    (issues: GateIssueDto[]): UpstreamPrompt | null => {
      if (issues.length !== 1 || issues[0].code !== "gate_remote_no_upstream") {
        return null;
      }
      if (!repo || !branch || remotes.length === 0 || repo.is_bare) {
        return null;
      }
      return { branch, remotes };
    },
    [repo, branch, remotes],
  );

  const run = useCallback(
    async (kind: RemoteSyncKind) => {
      if (busyRef.current || writeDisabled) {
        return;
      }
      setBusy(kind);
      setError(null);
      try {
        const request: WriteRequest = {
          kind,
          pull_mode: kind === "pull" ? pullMode : undefined,
        };
        const gate = await ipc.validateWrite(request);
        if (!gate.ok) {
          // 首次推送（ADR-0028）：不报死错误，改为确认「设置上游并推送」。
          const prompt = kind === "push" ? upstreamPrompt(gate.issues) : null;
          if (prompt) {
            setUpstream(prompt);
            return;
          }
          setError(gate.issues.map(issueText).join("\n"));
          return;
        }
        const outcome = await ipc.executeWrite(request);
        if (outcome.status !== "succeeded") {
          setError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
          return;
        }
        await onMutated(outcomeText(outcome));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(null);
      }
    },
    [onMutated, pullMode, upstreamPrompt, writeDisabled],
  );

  return {
    disabled: writeDisabled,
    busy,
    error,
    clearError,
    pullMode,
    setPullMode,
    run,
    upstream,
    closeUpstream,
  };
}
