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
import type { CommitSummaryDto, GateIssueDto, WriteRequest } from "../../shared/types";
import { GateReportView } from "../write/GateReportView";

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

  useEscClose(onCancel, busy);

  const submit = useCallback(async () => {
    const branch = name.trim();
    if (!branch || busyRef.current) {
      return;
    }
    const requestedRepoPath = captureOperationNoticeRepoPath();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind: "create_branch", branch, oid: start?.oid };
      const gate = await ipc.validateWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (!gate.ok) {
        const message = gate.issues.map(issueText).join("\n");
        setIssues(gate.issues);
        publishOperationNotice(writeErrorNotice("create_branch", message), requestedRepoPath);
        return;
      }
      const outcome = await ipc.executeWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (outcome.status !== "succeeded") {
        const message = outcomeText(outcome);
        setError(message);
        publishOperationNotice(
          writeOutcomeNotice("create_branch", outcome, { summary: message }),
          requestedRepoPath,
        );
        return;
      }
      publishOperationNotice(writeOutcomeNotice("create_branch", outcome), requestedRepoPath);
      await onMutated(outcomeText(outcome));
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        onCancel();
      }
    } catch (err) {
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        publishOperationNotice(writeErrorNotice("create_branch", message), requestedRepoPath);
      }
    } finally {
      busyRef.current = false;
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
          <GateReportView gate={null} gateError={null} validating={false} issues={issues} />
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
