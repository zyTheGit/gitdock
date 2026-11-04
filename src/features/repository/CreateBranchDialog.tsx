import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { CommitSummaryDto, GateIssueDto, WriteRequest } from "../../shared/types";

interface CreateBranchDialogProps {
  /** 图谱选中提交；null 表示以当前 HEAD 为起点。 */
  start: CommitSummaryDto | null;
  hasHead: boolean;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

export function CreateBranchDialog({
  start,
  hasHead,
  onCancel,
  onMutated,
}: CreateBranchDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
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
    const branch = name.trim();
    if (!branch || busyRef.current) {
      return;
    }
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind: "create_branch", branch, oid: start?.oid };
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
  }, [name, onCancel, onMutated, start?.oid]);

  const shortStart = start?.short_oid ?? "";
  const canSubmit = name.trim().length > 0 && (start !== null || hasHead) && !busy;

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{t("repository.createBranchTitle")}</h2>
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
        <label className="ref-field-label" htmlFor="ref-branch-name">
          {t("repository.branchNameLabel")}
        </label>
        <input
          id="ref-branch-name"
          className="ref-input"
          type="text"
          autoFocus
          disabled={busy}
          placeholder={t("repository.branchNamePlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <p className="muted confirm-hint">
          {start !== null
            ? t("repository.branchStartCommit", { oid: shortStart })
            : t("repository.branchStartHead")}
        </p>
        {!hasHead && start === null && (
          <p className="danger-text confirm-hint">{t("repository.noStartPoint")}</p>
        )}
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
        <button className="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? t("repository.branchCreating") : t("repository.createBranch")}
        </button>
      </footer>
    </Modal>
  );
}
