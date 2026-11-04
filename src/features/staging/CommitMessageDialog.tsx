import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { errorText, gateSummaryText, issueText, outcomeText, warningText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, GateReportDto, WriteKind, WriteOutcomeDto } from "../../shared/types";
import { outcomeMessage } from "../write/messages";

type CommitKind = Extract<WriteKind, "create_commit" | "amend_commit">;

interface CommitMessageDialogProps {
  /** unborn HEAD 时没有可 amend 的提交，amend 开关禁用。 */
  unborn: boolean;
  onCancel: () => void;
  /** 提交成功：调用方展示 toast 并刷新暂存区与图谱。 */
  onCommitted: (message: string) => Promise<void>;
}

/**
 * 提交消息对话框（ADR 0007 §2.3）：create 表单直执——消息本身就是显式意图，
 * Gate 拒绝项就地展示；amend 是历史改写，validate 通过后经专门确认再执行
 * （确认块展示将被替换的 HEAD 短 oid + 主题与 reflog 恢复指引）。
 */
export function CommitMessageDialog({ unborn, onCancel, onCommitted }: CommitMessageDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [amend, setAmend] = useState(false);
  const [amendLoading, setAmendLoading] = useState(false);
  const [amendUnborn, setAmendUnborn] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 非 null 时处于 amend 确认步。 */
  const [pendingGate, setPendingGate] = useState<GateReportDto | null>(null);

  const headMessageRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const pendingGateRef = useRef<GateReportDto | null>(null);
  const onCancelRef = useRef(onCancel);
  const onCommittedRef = useRef(onCommitted);
  busyRef.current = busy;
  pendingGateRef.current = pendingGate;
  onCancelRef.current = onCancel;
  onCommittedRef.current = onCommitted;

  // Esc 分层协议：对话框是最内层，捕获阶段消费 Esc，避免再退出暂存区视图。
  // 确认步返回消息表单；执行中不响应，等结果落地。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) {
        return;
      }
      consumeEsc(event);
      if (pendingGateRef.current) {
        setPendingGate(null);
      } else {
        onCancelRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const amendDisabled = unborn || amendUnborn;

  // 开启 amend 时经 read_head_message 预填现有消息；读不到（unborn）则禁用开关。
  const onAmendToggle = useCallback(
    async (next: boolean) => {
      if (!next || amendDisabled || amendLoading || busyRef.current) {
        setAmend(next);
        return;
      }
      if (headMessageRef.current === null) {
        setAmendLoading(true);
        setAmendError(null);
        try {
          const message = await ipc.readHeadMessage();
          if (message === null) {
            setAmendUnborn(true);
            return;
          }
          headMessageRef.current = message;
        } catch (err) {
          setAmendError(`${t("staging.amendLoadFailedPrefix")}${errorText(err)}`);
          return;
        } finally {
          setAmendLoading(false);
        }
      }
      setText(headMessageRef.current ?? "");
      setAmend(true);
    },
    [amendDisabled, amendLoading, t],
  );

  const applyOutcome = useCallback(async (kind: CommitKind, outcome: WriteOutcomeDto) => {
    if (outcome.status === "succeeded") {
      await onCommittedRef.current(outcomeMessage(kind, outcome));
      onCancelRef.current();
      return;
    }
    // failed / rejected（含 pre-commit hook 拒绝）：headline 与 stderr 都要可见。
    setError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
    setPendingGate(null);
  }, []);

  const submit = useCallback(async () => {
    const message = text.trim();
    if (!message || busyRef.current || amendLoading) {
      return;
    }
    const kind: CommitKind = amend ? "amend_commit" : "create_commit";
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const gate = await ipc.validateWrite({ kind, message });
      if (!gate.ok) {
        setIssues(gate.issues);
        return;
      }
      if (kind === "create_commit") {
        await applyOutcome(kind, await ipc.executeWrite({ kind, message }));
        return;
      }
      setPendingGate(gate);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [amend, amendLoading, applyOutcome, text]);

  const confirmAmend = useCallback(async () => {
    const message = text.trim();
    if (!message || busyRef.current) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await applyOutcome("amend_commit", await ipc.executeWrite({ kind: "amend_commit", message }));
    } catch (err) {
      setError(errorText(err));
      setPendingGate(null);
    } finally {
      setBusy(false);
    }
  }, [applyOutcome, text]);

  const onMessageKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  // 将被替换的 HEAD 短 oid + 主题来自 Gate 摘要参数（summary_args 带 oid/subject）。
  const amendHead = pendingGate?.summary_args
    ? {
        shortOid: pendingGate.summary_args.oid ?? "",
        summary: pendingGate.summary_args.subject ?? "",
      }
    : null;

  if (pendingGate) {
    return (
      <Modal className="confirm-dialog">
        <header>
          <h2>{t("staging.amendConfirmTitle")}</h2>
          <button
            className="detail-close"
            onClick={() => setPendingGate(null)}
            disabled={busy}
            aria-label={t("staging.commitCloseAria")}
          >
            ×
          </button>
        </header>

        <section>
          {amendHead && (
            <p className="confirm-target">
              <span className="mono">{amendHead.shortOid}</span>
              <span className="confirm-summary" title={amendHead.summary}>
                {amendHead.summary}
              </span>
            </p>
          )}
          <p className="danger-text confirm-hint">{t("staging.amendRewriteHint")}</p>
          <p className="muted confirm-hint">{t("staging.amendReflogHint")}</p>
        </section>

        <section className="gate-report">
          <h3>{t("write.gateTitle")}</h3>
          <p className="gate-ok">{gateSummaryText(pendingGate)}</p>
          {pendingGate.warnings.length > 0 && (
            <ul className="gate-issues">
              {pendingGate.warnings.map((warning) => (
                <li key={`${warning.code}:${warning.message}`}>{warningText(warning)}</li>
              ))}
            </ul>
          )}
        </section>

        <footer>
          <button onClick={() => setPendingGate(null)} disabled={busy}>
            {t("write.cancel")}
          </button>
          <button className="primary" onClick={() => void confirmAmend()} disabled={busy}>
            {busy ? t("staging.commitSubmitting") : t("staging.amendConfirmExecute")}
          </button>
        </footer>
      </Modal>
    );
  }

  const canSubmit = text.trim().length > 0 && !busy && !amendLoading;

  return (
    <Modal className="confirm-dialog commit-dialog">
      <header>
        <h2>{t("staging.commitTitle")}</h2>
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
        <label className="commit-message-label">{t("staging.commitMessageLabel")}</label>
        <textarea
          className="description-input"
          rows={6}
          autoFocus
          disabled={busy || amendLoading}
          placeholder={t("staging.commitMessagePlaceholder")}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onMessageKeyDown}
        />
        <label className="commit-amend-row">
          <input
            type="checkbox"
            checked={amend}
            disabled={amendDisabled || amendLoading || busy}
            onChange={(event) => void onAmendToggle(event.target.checked)}
          />
          {t("staging.amendToggle")}
        </label>
        {amendLoading && <p className="muted confirm-hint">{t("staging.amendLoadingMessage")}</p>}
        {amendDisabled && <p className="muted confirm-hint">{t("staging.amendUnbornHint")}</p>}
        {amend && !amendLoading && (
          <div className="commit-amend-hints">
            <p>{t("staging.amendRewriteHint")}</p>
            <p>{t("staging.amendReflogHint")}</p>
          </div>
        )}
        {amendError && <p className="danger-text">{amendError}</p>}
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
          {busy ? t("staging.commitSubmitting") : t("staging.commitSubmit")}
        </button>
      </footer>
    </Modal>
  );
}