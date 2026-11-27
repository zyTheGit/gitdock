import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import {
  captureOperationNoticeRepoPath,
  publishOperationNotice,
  writeErrorNotice,
  writeOutcomeNotice,
} from "../../app/operationNotice";
import { useI18n } from "../../i18n";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { WriteRequest } from "../../shared/types";
import { GateReportView } from "./GateReportView";
import { useGatePreview } from "./useGatePreview";

interface RemoteWriteDialogProps {
  /** 待执行的写请求；null 表示信息不全（例如还没选远程），此时禁止执行。 */
  request: WriteRequest | null;
  title: string;
  /** 目标行（分支/标签 + 远程），等宽字体展示。 */
  target: string;
  hint: string;
  /** 破坏性或外部可见的后果提示（危险色）。 */
  warning?: string;
  /** request 为 null 时的原因说明（例如需要先选择远程）。 */
  missingHint?: string;
  confirmLabel: string;
  busyLabel: string;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
  /** 附加输入（本地分支名、远程选择），显示在 Gate 结论之前。 */
  children?: ReactNode;
}

/**
 * 远程写操作的统一确认框（ADR-0028）：先展示 Gate 结论，Gate 通过且用户确认后才执行。
 * 本地分支名 / remote 选择由各调用方作为 children 提供，变化时自动重跑 Gate。
 */
export function RemoteWriteDialog({
  request,
  title,
  target,
  hint,
  warning,
  missingHint,
  confirmLabel,
  busyLabel,
  onCancel,
  onMutated,
  children,
}: RemoteWriteDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const preview = useGatePreview(request);
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEscClose(onCancel, busy);

  const execute = useCallback(async () => {
    if (busyRef.current || !request || !preview.gate?.ok) {
      return;
    }
    const requestedRepoPath = captureOperationNoticeRepoPath();
    busyRef.current = true;
    setBusy(true);
    setExecError(null);
    try {
      const outcome = await ipc.executeWrite(request);
      if (captureOperationNoticeRepoPath() !== requestedRepoPath) {
        return;
      }
      if (outcome.status !== "succeeded") {
        const message = outcomeText(outcome);
        setExecError(message);
        publishOperationNotice(
          writeErrorNotice(request.kind, message, outcome.stderr),
          requestedRepoPath,
        );
        return;
      }
      publishOperationNotice(writeOutcomeNotice(request.kind, outcome), requestedRepoPath);
      await onMutated(outcomeText(outcome));
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        onCancel();
      }
    } catch (err) {
      if (captureOperationNoticeRepoPath() === requestedRepoPath) {
        const message = errorText(err);
        setExecError(message);
        publishOperationNotice(writeErrorNotice(request.kind, message), requestedRepoPath);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [request, preview.gate, onCancel, onMutated]);

  const blocked = busy || !request || preview.validating || Boolean(preview.gateError) || !preview.gate?.ok;

  return (
    <Modal className="confirm-dialog" labelledBy={titleId}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={busy}
          aria-label={t("write.closeDialogAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="confirm-target">
          <span className="mono">{target}</span>
        </p>
        <p className="muted confirm-hint">{hint}</p>
        {warning && <p className="danger-text confirm-hint">{warning}</p>}
        {children}
        {!request && missingHint && <p className="muted confirm-hint">{missingHint}</p>}
      </section>

      {request && (
        <GateReportView
          gate={preview.gate}
          gateError={preview.gateError}
          validating={preview.validating}
        />
      )}

      {execError && (
        <section>
          <p className="danger-text">{execError}</p>
        </section>
      )}

      <footer>
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="primary" onClick={() => void execute()} disabled={blocked}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
