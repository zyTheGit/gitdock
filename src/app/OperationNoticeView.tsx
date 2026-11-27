import { useEffect } from "react";
import { useI18n } from "../i18n";
import "../styles/notices.css";
import {
  expireOperationNotices,
  OPERATION_NOTICE_SUCCESS_TTL_MS,
  type OperationNotice,
  type OperationNoticeAction,
} from "./operationNotice";

interface OperationNoticeProps {
  notice: OperationNotice;
  onDismiss: (id: number) => void;
  onAction: (action: OperationNoticeAction) => void;
}

interface OperationNoticeStackProps {
  notices: readonly OperationNotice[];
  onDismiss: (id: number) => void;
  onAction: (action: OperationNoticeAction) => void;
}

function OperationNoticeCard({ notice, onDismiss, onAction }: OperationNoticeProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (notice.tone !== "success") {
      return;
    }
    const expiresAt = notice.expiresAt ?? Date.now() + OPERATION_NOTICE_SUCCESS_TTL_MS;
    const timer = window.setTimeout(
      () => expireOperationNotices(expiresAt),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [notice.expiresAt, notice.id, notice.tone]);

  return (
    <section
      className={`operation-notice operation-notice-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <header className="operation-notice-header">
        <strong>{notice.title}</strong>
        <button
          className="operation-notice-close"
          onClick={() => onDismiss(notice.id)}
          aria-label={t("notices.closeAria")}
          title={t("notices.closeAria")}
        >
          ×
        </button>
      </header>
      <p className="operation-notice-summary">{notice.summary}</p>
      {notice.details && <p className="operation-notice-details">{notice.details}</p>}
      {notice.stderr && (
        <details className="operation-notice-stderr">
          <summary>{t("notices.stderrDetails")}</summary>
          <pre>{notice.stderr}</pre>
        </details>
      )}
      {notice.actions && notice.actions.length > 0 && (
        <div className="operation-notice-actions">
          {notice.actions.map((action) => (
            <span className="operation-notice-action" key={action.id}>
              <button
                onClick={() => onAction(action)}
                disabled={Boolean(action.disabledReason)}
                title={action.disabledReason}
              >
                {action.label}
              </button>
              {action.disabledReason && (
                <span className="operation-notice-disabled-reason">{action.disabledReason}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** 单条入口保留给既有弹层组合；多通知仓库统一使用 OperationNoticeStack。 */
export function OperationNotice(props: OperationNoticeProps) {
  return (
    <div className="operation-notice-stack">
      <OperationNoticeCard {...props} />
    </div>
  );
}

export function OperationNoticeStack({ notices, onDismiss, onAction }: OperationNoticeStackProps) {
  return (
    <div className="operation-notice-stack">
      {notices.map((notice) => (
        <OperationNoticeCard
          key={notice.id}
          notice={notice}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
