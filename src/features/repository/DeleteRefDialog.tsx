import { useCallback, useRef, useState } from "react";
import {
  captureOperationNoticeRepoPath,
  publishOperationNotice,
  remoteDeletePartialNotice,
  writeErrorNotice,
  writeOutcomeNotice,
} from "../../app/operationNotice";
import { useI18n } from "../../i18n";
import { useEscClose } from "../../shared/useEscClose";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, WriteKind, WriteRequest } from "../../shared/types";
import { GateReportView } from "../write/GateReportView";

export type DeleteKind = Extract<WriteKind, "delete_branch" | "delete_tag">;

interface DeleteRefDialogProps {
  kind: DeleteKind;
  name: string;
  /** 同时删除远程同名引用（ADR 0022）：本地成功后再执行 push --delete。 */
  remote?: boolean;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/** 删除本地分支/标签的专门确认框（ADR 0008 §2.6）；远程删除语义见 ADR 0022。 */
export function DeleteRefDialog({ kind, name, remote, onCancel, onMutated }: DeleteRefDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);

  useEscClose(onCancel, busy);

  const joinIssues = (list: GateIssueDto[]) => list.map((issue) => issueText(issue)).join("；");

  const submit = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    const requestedRepoPath = captureOperationNoticeRepoPath();
    let localMessage: string | null = null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const request: WriteRequest = { kind, branch: name };
      const gate = await ipc.validateWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (!gate.ok) {
        const message = joinIssues(gate.issues);
        setIssues(gate.issues);
        publishOperationNotice(writeErrorNotice(kind, message), requestedRepoPath);
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
          writeOutcomeNotice(kind, outcome, { summary: message }),
          requestedRepoPath,
        );
        return;
      }
      localMessage = outcomeText(outcome);
      if (!remote) {
        publishOperationNotice(writeOutcomeNotice(kind, outcome), requestedRepoPath);
        await onMutated(localMessage);
        if (captureOperationNoticeRepoPath() === requestedRepoPath) {
          onCancel();
        }
        return;
      }
      // 本地已删除：先刷新本地结果，再尝试远程，失败时也不能伪装成整体成功。
      await onMutated(localMessage);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      const remoteKind: WriteKind =
        kind === "delete_branch" ? "delete_branch_remote" : "delete_tag_remote";
      const remoteRequest: WriteRequest = { kind: remoteKind, branch: name };
      const remoteGate = await ipc.validateWrite(remoteRequest);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (!remoteGate.ok) {
        const remoteMessage = joinIssues(remoteGate.issues);
        setError([localMessage, remoteMessage].filter(Boolean).join("\n\n"));
        publishOperationNotice(
          remoteDeletePartialNotice(kind, localMessage, remoteMessage),
          requestedRepoPath,
        );
        return;
      }
      const remoteOutcome = await ipc.executeWrite(remoteRequest);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (remoteOutcome.status !== "succeeded") {
        const remoteMessage = outcomeText(remoteOutcome);
        setError([localMessage, remoteMessage].filter(Boolean).join("\n\n"));
        publishOperationNotice(
          remoteDeletePartialNotice(kind, localMessage, remoteMessage, remoteOutcome.stderr),
          requestedRepoPath,
        );
        return;
      }
      publishOperationNotice(
        writeOutcomeNotice(remoteKind, remoteOutcome, { details: localMessage }),
        requestedRepoPath,
      );
      await onMutated(outcomeText(remoteOutcome));
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        onCancel();
      }
    } catch (err) {
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        publishOperationNotice(
          localMessage === null
            ? writeErrorNotice(kind, message)
            : remoteDeletePartialNotice(kind, localMessage, message),
          requestedRepoPath,
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [kind, name, remote, onCancel, onMutated]);

  const isBranch = kind === "delete_branch";
  // 远程删除的标题/警告按引用类型分开：标签与分支的语义与可恢复性不同。
  const title = remote
    ? t(isBranch ? "repository.deleteBranchRemoteTitle" : "repository.deleteTagRemoteTitle")
    : isBranch
      ? t("repository.deleteBranchTitle")
      : t("repository.deleteTagTitle");
  const warning = remote
    ? t(isBranch ? "repository.deleteBranchRemoteWarning" : "repository.deleteTagRemoteWarning")
    : isBranch
      ? t("repository.deleteBranchWarning")
      : t("repository.deleteTagWarning");

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
          <GateReportView gate={null} gateError={null} validating={false} issues={issues} />
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