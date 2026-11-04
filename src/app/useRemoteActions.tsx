import { useCallback, useRef, useState } from "react";
import { errorText, issueText, outcomeText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { RemoteSyncKind, WriteRequest } from "../shared/types";

interface UseRemoteActionsParams {
  writeDisabled: boolean;
  onMutated: (message: string) => Promise<void>;
}

export interface RemoteActions {
  disabled: boolean;
  busy: RemoteSyncKind | null;
  error: string | null;
  run: (kind: RemoteSyncKind) => void;
}

/** fetch / pull --ff-only / push 的直执入口（ADR 0010），不做额外确认框。 */
export function useRemoteActions({ writeDisabled, onMutated }: UseRemoteActionsParams) {
  const [busy, setBusy] = useState<RemoteSyncKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy !== null;

  const run = useCallback(
    async (kind: RemoteSyncKind) => {
      if (busyRef.current || writeDisabled) {
        return;
      }
      setBusy(kind);
      setError(null);
      try {
        const request: WriteRequest = { kind };
        const gate = await ipc.validateWrite(request);
        if (!gate.ok) {
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
    [onMutated, writeDisabled],
  );

  return { disabled: writeDisabled, busy, error, run };
}