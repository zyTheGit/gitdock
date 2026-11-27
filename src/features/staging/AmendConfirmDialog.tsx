import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { Modal } from "../../shared/Modal";
import type { GateReportDto } from "../../shared/types";
import { GateReportView } from "../write/GateReportView";

interface AmendConfirmDialogProps {
  /** 已通过 Gate 的 amend 报告；summary_args 带被替换 HEAD 的 oid/subject。 */
  gate: GateReportDto;
  /** 当前分支已推送到上游且无本地领先提交时为 true，展示改写远端历史警示。 */
  pushedRisk?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * amend 二次确认（历史改写）：展示被替换的 HEAD 与 reflog 恢复指引。
 * Esc 分层协议：本框是最内层，捕获阶段消费 Esc 只关闭自己，执行中不响应。
 */
export function AmendConfirmDialog({
  gate,
  pushedRisk = true,
  busy,
  onCancel,
  onConfirm,
}: AmendConfirmDialogProps) {
  const { t } = useI18n();
  const busyRef = useRef(busy);
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

  // 被替换的 HEAD 短 oid + 主题来自 Gate 摘要参数（summary_args 带 oid/subject）。
  const head = {
    shortOid: gate.summary_args?.oid ?? "",
    summary: gate.summary_args?.subject ?? "",
  };

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{t("staging.amendConfirmTitle")}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={busy}
          aria-label={t("staging.commitCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        {gate.summary_args && (
          <p className="confirm-target">
            <span className="mono">{head.shortOid}</span>
            <span className="confirm-summary" title={head.summary}>
              {head.summary}
            </span>
          </p>
        )}
        <p className={pushedRisk ? "danger-text confirm-hint" : "confirm-hint"}>
          {t(pushedRisk ? "staging.amendRewriteHint" : "staging.amendLocalHint")}
        </p>
        <p className="muted confirm-hint">{t("staging.amendReflogHint")}</p>
      </section>

      <GateReportView gate={gate} gateError={null} validating={false} />

      <footer>
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="primary" onClick={onConfirm} disabled={busy}>
          {busy ? t("staging.commitSubmitting") : t("staging.amendConfirmExecute")}
        </button>
      </footer>
    </Modal>
  );
}
