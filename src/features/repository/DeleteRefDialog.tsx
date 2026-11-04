import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, WriteKind, WriteRequest } from "../../shared/types";

export type DeleteKind = Extract<WriteKind, "delete_branch" | "delete_tag">;

interface DeleteRefDialogProps {
  kind: DeleteKind;
  name: string;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/** 删除本地分支/标签的专门确认框（ADR 0008 §2.6）。 */
export function DeleteRefDialog({ kind, name, onCancel, onMutated }: DeleteRefDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) {
        return;
      }
      consumeEsc(event);
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const submit = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind, branch: name };
      const gate = await ipc.validateWrite(request);
      if (!gate.ok) {
        setIssues(gate.issues);
        return;
      }
      const outcome = await ipc.executeWrite(request);
      if (outcome.status !== "succeeded") {
        setError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        return;
      }
      await onMutated(outcomeText(outcome));
      onCancel();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [kind, name, onCancel, onMutated]);

  const isBranch = kind === "delete_branch";
  const title = isBranch ? t("repository.deleteBranchTitle") : t("repository.deleteTagTitle");
  const warning = isBranch ? t("repository.deleteBranchWarning") : t("repository.deleteTagWarning");

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{title}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={busy}
          aria-label={t("staging.close")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="confirm-target">
          <span className="mono">{name}</span>
        </p>
        <p className="danger-text confirm-hint">{warning}</p>
        {issues && (
          <div className="gate-report">
            <p className="danger-text">{t("write.gateFailedPrefix")}</p>
            <ul className="gate-issues">
              {issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="danger-text">{error}</p>}
      </section>

      <footer>
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="danger" onClick={() => void submit()} disabled={busy}>
          {busy ? t("repository.refDeleting") : t("repository.deleteRef")}
        </button>
      </footer>
    </Modal>
  );
}