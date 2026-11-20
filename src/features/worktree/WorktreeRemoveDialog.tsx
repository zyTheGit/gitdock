import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, outcomeText } from "../../shared/error";
import { shortOid } from "../../shared/format";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { WorktreeDto, WriteRequest } from "../../shared/types";
import { useEscClose } from "../../shared/useEscClose";
import { GateReportView } from "../write/GateReportView";
import { useGatePreview } from "../write/useGatePreview";

interface WorktreeRemoveDialogProps {
  entry: WorktreeDto;
  onClose: () => void;
  /** 移除成功：调用方展示结果文案并刷新列表。 */
  onRemoved: (message: string) => Promise<void>;
}

/**
 * 移除 linked worktree（ADR-0034）：破坏性确认，说明目录会被删除、不保留未提交
 * 改动、Git 会拒绝移除不干净的工作区；不提供 force 开关。Gate 预检在这里就能
 * 把「脏工作区 / 已锁定 / 主 worktree」转成可读拒绝原因。
 */
export function WorktreeRemoveDialog({ entry, onClose, onRemoved }: WorktreeRemoveDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEscClose(onClose, busy);

  const request = useMemo<WriteRequest>(
    () => ({ kind: "remove_worktree", path: entry.path }),
    [entry.path],
  );
  const preview = useGatePreview(request);
  const label =
    entry.branch ?? (entry.head_oid ? shortOid(entry.head_oid) : t("worktree.detached"));

  const execute = useCallback(async () => {
    if (busyRef.current || !preview.gate?.ok) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setExecError(null);
    try {
      const outcome = await ipc.removeWorktree(entry.path);
      if (outcome.status !== "succeeded") {
        setExecError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        return;
      }
      await onRemoved(outcomeText(outcome));
      onClose();
    } catch (err) {
      setExecError(errorText(err));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [entry.path, onClose, onRemoved, preview.gate]);

  return (
    <Modal
      className="confirm-dialog worktree-dialog"
      onBackdropClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <header>
        <div>
          <h2>{t("worktree.removeTitle")}</h2>
          <p className="muted settings-hint">{t("worktree.removeSubtitle")}</p>
        </div>
        <button
          className="detail-close"
          onClick={onClose}
          disabled={busy}
          aria-label={t("write.closeDialogAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="confirm-target">
          <span className="mono">{label}</span>
          <span className="confirm-summary mono" title={entry.path}>
            {entry.path}
          </span>
        </p>
        <p className="danger-text confirm-hint">{t("worktree.removeWarning")}</p>
      </section>

      <GateReportView
        gate={preview.gate}
        gateError={preview.gateError}
        validating={preview.validating}
      />

      {execError && (
        <section>
          <p className="danger-text">{execError}</p>
        </section>
      )}

      <footer>
        <button onClick={onClose} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button
          className="danger"
          onClick={() => void execute()}
          disabled={busy || !preview.gate?.ok}
        >
          {busy ? t("worktree.removing") : t("worktree.removeConfirm")}
        </button>
      </footer>
    </Modal>
  );
}
