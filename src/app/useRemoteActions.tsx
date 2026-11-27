import { useCallback, useEffect, useRef, useState } from "react";
import {
  publishOperationNotice,
  writeErrorNotice,
  writeOutcomeNotice,
} from "./operationNotice";
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
  /** Pull 模式由当次菜单选择显式传入，避免 setState 后执行读到旧模式。 */
  run: (kind: RemoteSyncKind, pullMode?: PullMode) => void;
  /** push 因「没有上游」被拒时的替代流程；非 null 时展示设置上游确认框。 */
  upstream: UpstreamPrompt | null;
  closeUpstream: () => void;
}

/** fetch / pull / push 的直执入口（ADR 0010）；唯一例外是 push 缺上游时转入确认框（ADR-0028）。 */
export function useRemoteActions({ repo, writeDisabled, onMutated }: UseRemoteActionsParams) {
  const [busy, setBusy] = useState<RemoteSyncKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<UpstreamPrompt | null>(null);
  const busyRef = useRef(false);

  const repoPath = repo?.path ?? null;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const branch = repo && repo.head.kind === "branch" ? repo.head.branch ?? null : null;
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
      const args = issues[0].args ?? {};
      const remotes = args.remote
        ? [args.remote]
        : args.options?.split("、").filter(Boolean) ?? [];
      if (!repo || !branch || remotes.length === 0 || repo.is_bare) {
        return null;
      }
      return { branch, remotes };
    },
    [repo, branch],
  );

  const run = useCallback(
    async (kind: RemoteSyncKind, selectedPullMode?: PullMode) => {
      if (busyRef.current || writeDisabled || !repoPath) {
        return;
      }
      const requestedRepoPath = repoPath;
      // 先同步占锁，再触发渲染；同一事件循环内的快速连点也不能提交第二个请求。
      busyRef.current = true;
      setBusy(kind);
      setError(null);
      try {
        const request: WriteRequest = {
          kind,
          pull_mode: kind === "pull" ? selectedPullMode ?? "ff_only" : undefined,
        };
        const gate = await ipc.validateWrite(request);
        if (repoPathRef.current !== requestedRepoPath) {
          return;
        }
        if (!gate.ok) {
          // 首次推送（ADR-0028）：不报死错误，改为确认「设置上游并推送」。
          const prompt = kind === "push" ? upstreamPrompt(gate.issues) : null;
          if (prompt) {
            setUpstream(prompt);
            return;
          }
          const message = gate.issues.map(issueText).join("\n");
          setError(message);
          publishOperationNotice(writeErrorNotice(kind, message), requestedRepoPath);
          return;
        }
        const outcome = await ipc.executeWrite(request);
        if (repoPathRef.current !== requestedRepoPath) {
          return;
        }
        if (outcome.status !== "succeeded") {
          const message = outcomeText(outcome);
          setError(message);
          publishOperationNotice(
            writeOutcomeNotice(kind, outcome, { summary: message }),
            requestedRepoPath,
          );
          return;
        }
        publishOperationNotice(writeOutcomeNotice(kind, outcome), requestedRepoPath);
        await onMutated(outcomeText(outcome));
      } catch (err) {
        if (repoPathRef.current === requestedRepoPath) {
          const message = errorText(err);
          setError(message);
          publishOperationNotice(writeErrorNotice(kind, message), requestedRepoPath);
        }
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [onMutated, repoPath, upstreamPrompt, writeDisabled],
  );

  return {
    disabled: writeDisabled,
    busy,
    error,
    clearError,
    run,
    upstream,
    closeUpstream,
  };
}
