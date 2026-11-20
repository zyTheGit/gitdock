import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { issueText, warningText } from "../../shared/error";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, WarningDto } from "../../shared/types";

interface HunkDiscardConfirmDialogProps {
  /** 目标文件（仓库内相对路径）。 */
  path: string;
  /** 1 起始的块序号与当前块总数。 */
  ordinal: number;
  total: number;
  /** Gate 未通过时的拒绝原因。 */
  issues: GateIssueDto[] | null;
  /** Gate 警告（`hunk_discard_destructive` 等）。 */
  warnings: WarningDto[] | null;
  /** 执行失败 / 被拒的说明（含 stderr）。 */
  error: string | null;
  validating: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenStash: () => void;
}

/**
 * 丢弃单个 hunk 的强破坏性确认框（ADR 0027 §2.4）：不经 reflog 的永久销毁，
 * 因此必须显式确认。列明文件、块序号与「同文件其他块不受影响」，
 * Esc / 遮罩取消，执行中不响应。
 */
export function HunkDiscardConfirmDialog({
  path,
  ordinal,
  total,
  issues,
  warnings,
  error,
  validating,
  busy,
  onCancel,
  onConfirm,
  onOpenStash,
}: HunkDiscardConfirmDialogProps) {
  const { t } = useI18n();
  const working = validating || busy;
  const workingRef = useRef(working);
  workingRef.current = working;

  // Esc 分层：本框是最内层，捕获阶段消费 Esc 只关闭自己（执行中只吞掉不关闭）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      consumeEsc(event);
      if (!workingRef.current) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const confirmLabel = busy
    ? t("staging.discardSubmitting")
    : validating
      ? t("staging.discardValidating")
      : t("staging.hunkDiscardConfirm");

  return (
    <Modal className="confirm-dialog discard-dialog" onBackdropClick={working ? undefined : onCancel}>
      <header>
        <h2>{t("staging.hunkDiscardConfirmTitle")}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={working}
          aria-label={t("staging.hunkDiscardCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="danger-text confirm-hint">{t("staging.hunkDiscardConfirmHint")}</p>
        <div className="discard-paths">
          <div>
            <p className="muted">{t("staging.hunkDiscardTargetLabel")}</p>
            <ul className="gate-paths">
              <li className="mono">{path}</li>
            </ul>
          </div>
          <p className="mono">{t("staging.hunkDiscardOrdinal", { n: ordinal, total })}</p>
        </div>
      </section>

      {(issues || (warnings && warnings.length > 0)) && (
        <section className="gate-report">
          <h3>{t("write.gateTitle")}</h3>
          {issues ? (
            <>
              <p className="danger-text">{t("write.gateFailedPrefix")}</p>
              <ul className="gate-issues">
                {issues.map((issue) => (
                  <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {warnings?.map((warning) => (
            <p className="gate-warning" key={`${warning.code}:${warning.message}`}>
              {warningText(warning)}
            </p>
          ))}
        </section>
      )}

      {error && (
        <p className="danger-text discard-outcome" role="alert">
          {error}
        </p>
      )}

      <footer>
        <button className="link discard-stash" onClick={onOpenStash} disabled={working}>
          {t("staging.discardOpenStash")}
        </button>
        <button onClick={onCancel} disabled={working}>
          {t("write.cancel")}
        </button>
        <button className="danger" onClick={onConfirm} disabled={working}>
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
