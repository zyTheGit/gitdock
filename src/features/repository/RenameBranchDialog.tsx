import { useCallback, useRef, useState } from "react";
import {
  captureOperationNoticeRepoPath,
  publishOperationNotice,
  writeErrorNotice,
  writeOutcomeNotice,
} from "../../app/operationNotice";
import { useI18n } from "../../i18n";
import { useEscClose } from "../../shared/useEscClose";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, GateReportDto, WriteRequest } from "../../shared/types";
import { GateReportView } from "../write/GateReportView";

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
  pendingGateRef.current = pendingGate;

  const closePending = useCallback(() => {
    pendingGateRef.current = null;
    setPendingGate(null);
  }, []);

  useEscClose(() => {
    if (pendingGateRef.current) {
      closePending();
    } else {
      onCancel();
    }
  }, busy);

  const submit = useCallback(async () => {
    const newName = name.trim();
    if (!newName || busyRef.current) {
      return;
    }
    const requestedRepoPath = captureOperationNoticeRepoPath();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind: "rename_branch", branch, new_name: newName };
      const gate = await ipc.validateWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (!gate.ok) {
        const message = gate.issues.map(issueText).join("\n");
        setIssues(gate.issues);
        publishOperationNotice(writeErrorNotice("rename_branch", message), requestedRepoPath);
        return;
      }
      pendingGateRef.current = gate;
      setPendingGate(gate);
    } catch (err) {
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        publishOperationNotice(writeErrorNotice("rename_branch", message), requestedRepoPath);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [branch, name]);

  const confirm = useCallback(async () => {
    const newName = name.trim();
    if (!newName || busyRef.current) {
      return;
    }
    const requestedRepoPath = captureOperationNoticeRepoPath();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const request: WriteRequest = { kind: "rename_branch", branch, new_name: newName };
      const outcome = await ipc.executeWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (outcome.status !== "succeeded") {
        const message = outcomeText(outcome);
        setError(message);
        pendingGateRef.current = null;
        setPendingGate(null);
        publishOperationNotice(
          writeOutcomeNotice("rename_branch", outcome, { summary: message }),
          requestedRepoPath,
        );
        return;
      }
      publishOperationNotice(writeOutcomeNotice("rename_branch", outcome), requestedRepoPath);
      await onMutated(outcomeText(outcome));
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        onCancel();
      }
    } catch (err) {
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        pendingGateRef.current = null;
        setPendingGate(null);
        publishOperationNotice(writeErrorNotice("rename_branch", message), requestedRepoPath);
      }
    } finally {
      busyRef.current = false;
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
            onClick={closePending}
            disabled={busy}
            aria-label={t("staging.close")}
          >
            ×
          </button>
        </header>

        <section>
          <p className="muted confirm-hint">{t("repository.renameBranchHint")}</p>
        </section>

        <GateReportView
          gate={pendingGate}
          gateError={null}
          validating={false}
        />

        <footer>
          <button onClick={closePending} disabled={busy}>
            {t("write.cancel")}
          </button>
          <button className="primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("repository.branchRenaming") : t("repository.renameBranchConfirmAction")}
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
          <GateReportView gate={null} gateError={null} validating={false} issues={issues} />
        )}
        {error && <p className="danger-text">{error}</p>}
      </section>

      <footer>
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? t("repository.branchValidating") : t("repository.renameBranchCheck")}
        </button>
      </footer>
    </Modal>
  );
}
    
