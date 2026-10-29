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
} from "../shared/types";

export type PromptWriteKind = Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch">;

export interface WritePrompt {
  kind: PromptWriteKind;
  commit?: CommitSummaryDto;
  branch?: string;
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const start = useCallback(
    async (
      kind: PromptWriteKind,
      target: { commit?: CommitSummaryDto; branch?: string },
    ) => {
      setError(null);
      setDiagnostic(null);
      setPrompt({ kind, ...target, gate: null });
      const stillCurrent = (current: WritePrompt | null) =>
        Boolean(current) &&
        current!.kind === kind &&
        current!.commit?.oid === target.commit?.oid &&
        current!.branch === target.branch;
      try {
        const gate = await ipc.validateWrite({
          kind,
          oid: target.commit?.oid,
          branch: target.branch,
        });
        setPrompt((current) => (stillCurrent(current) ? { ...current!, gate } : current));
      } catch (err) {
        setPrompt((current) =>
          stillCurrent(current) ? { ...current!, gateError: errorText(err) } : current,
        );
      }
    },
    [setDiagnostic, setError],
  );

  const run = useCallback(async () => {
    if (!prompt?.gate?.ok) {
      return;
    }
    const { kind, commit, branch } = prompt;
    const repoPath = repo?.path;
    setBusy(true);
    setError(null);
    setDiagnostic(null);
    try {
      const outcome = await ipc.executeWrite({ kind, oid: commit?.oid, branch });
      setPrompt(null);
      setToast(outcomeMessage(kind, outcome, branch));
      if (outcome.status === "failed") {
        setError(outcome.message);
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
  }, [prompt, repo?.path, readSnapshot, applySnapshot, reload, setDiagnostic, setError, setToast]);

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

  return { prompt, busy, start, run, cancel, disabled };
}
