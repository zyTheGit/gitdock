import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { errorText, gateSummaryText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, GateReportDto, WriteRequest } from "../../shared/types";

interface RenameBranchDialogProps {
  branch: string;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/**
 * 分支重命名（ADR 0008 §2.4）：先过 Gate，再展示专门确认块。
 * 重命名只移动引用名，不重写历史；改回原名即可恢复。
 */
export function RenameBranchDialog({ branch, onCancel, onMutated }: RenameBranchDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(branch);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingGate, setPendingGate] = useState<GateReportDto | null>(null);

  const busyRef = useRef(false);
  const pendingGateRef = useRef<GateReportDto | null>(null);
  busyRef.current = busy;
  pendingGateRef.current = pendingGate;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) {
        return;
      }
      consumeEsc(event);
      if (pendingGateRef.current) {
        setPendingGate(null);
      } else {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const submit = useCallback(async () => {
    const newName = name.trim();
    if (!newName || busyRef.current) {
      return;
    }
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind: "rename_branch", branch, new_name: newName };
      const gate = await ipc.validateWrite(request);
      if (!gate.ok) {
        setIssues(gate.issues);
        return;
      }
      setPendingGate(gate);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [branch, name]);

  const confirm = useCallback(async () => {
    const newName = name.trim();
    if (!newName || busyRef.current) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const request: WriteRequest = { kind: "rename_branch", branch, new_name: newName };
      const outcome = await ipc.executeWrite(request);
      if (outcome.status !== "succeeded") {
        setError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        setPendingGate(null);
        return;
      }
      await onMutated(outcomeText(outcome));
      onCancel();
    } catch (err) {
      setError(errorText(err));
      setPendingGate(null);
    } finally {
      setBusy(false);
    }
  }, [branch, name, onCancel, onMutated]);

  if (pendingGate) {
    return (
      <Modal className="confirm-dialog">
        <header>
          <h2>{t("repository.renameBranchConfirmTitle")}</h2>
          <button
            className="detail-close"
            onClick={() => setPendingGate(null)}
            disabled={busy}
            aria-label={t("staging.close")}
          >
            ×
          </button>
        </header>

        <section>
          <p className="gate-ok">{gateSummaryText(pendingGate)}</p>
          <p className="muted confirm-hint">{t("repository.renameBranchHint")}</p>
        </section>

        <footer>
          <button onClick={() => setPendingGate(null)} disabled={busy}>
            {t("write.cancel")}
          </button>
          <button className="primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("repository.branchRenaming") : t("repository.renameBranch")}
          </button>
        </footer>
      </Modal>
    );
  }

  const canSubmit = name.trim().length > 0 && name.trim() !== branch && !busy;

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{t("repository.renameBranchTitle")}</h2>
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
        <label className="ref-field-label" htmlFor="ref-rename-name">
          {t("repository.newBranchNameLabel", { branch })}
        </label>
        <input
          id="ref-rename-name"
          className="ref-input"
          type="text"
          autoFocus
          disabled={busy}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
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
          {busy ? t("repository.branchValidating") : t("repository.renameBranch")}
        </button>
      </footer>
    </Modal>
  );
}
    
