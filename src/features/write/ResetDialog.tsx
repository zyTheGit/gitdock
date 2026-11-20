import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { CommitSummaryDto, ResetMode, WriteRequest } from "../../shared/types";
import { GateReportView } from "./GateReportView";
import { useGatePreview } from "./useGatePreview";

interface ResetDialogProps {
  /** 重置目标提交（右键菜单里的那一行）；列表/比较视图同样适用。 */
  commit: CommitSummaryDto;
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

const MODES: ResetMode[] = ["soft", "mixed", "hard"];

/**
 * 本地回退确认框（ADR-0029 §2.4）：soft / mixed / hard 三选一，
 * hard 额外要求勾选「未提交改动不可恢复」才能点红色确认按钮。
 * 执行前必须 Gate 通过；模式变化会用 useGatePreview 重新校验。
 */
export function ResetDialog({ commit, onCancel, onMutated }: ResetDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEscClose(onCancel, busy);

  // reset 复用通用 validate/execute seam；模式是请求字段而不是独立命令（ADR-0029 §2.1）。
  const request = useMemo<WriteRequest>(
    () => ({ kind: "reset", oid: commit.oid, reset_mode: mode }),
    [commit.oid, mode],
  );
  const preview = useGatePreview(request);
  const destructive = mode === "hard";
  // Gate 通过才允许执行；hard 还要求当前模式下的显式勾选。
  const blocked =
    busy ||
    Boolean(preview.gateError) ||
    preview.validating ||
    !preview.gate?.ok ||
    (destructive && !acknowledged);

  const modeLabel: Record<ResetMode, string> = {
    soft: t("write.resetModeSoft"),
    mixed: t("write.resetModeMixed"),
    hard: t("write.resetModeHard"),
  };
  const modeHint: Record<ResetMode, string> = {
    soft: t("write.resetModeSoftHint"),
    mixed: t("write.resetModeMixedHint"),
    hard: t("write.resetModeHardHint"),
  };

  const changeMode = useCallback((next: ResetMode) => {
    setMode(next);
    // 勾选只对做出选择时的模式有效：切走再切回要重新确认。
    setAcknowledged(false);
  }, []);

  const execute = useCallback(async () => {
    if (busyRef.current || !preview.gate?.ok || (mode === "hard" && !acknowledged)) {
      return;
    }
    // 同步占用：连点时第二次调用在重渲染前就会命中这里。
    busyRef.current = true;
    setBusy(true);
    setExecError(null);
    try {
      const outcome = await ipc.executeWrite(request);
      if (outcome.status !== "succeeded") {
        setExecError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        return;
      }
      await onMutated(outcomeText(outcome));
      onCancel();
    } catch (err) {
      setExecError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [acknowledged, mode, onCancel, onMutated, preview.gate, request]);

  return (
    <Modal
      className="confirm-dialog reset-dialog"
      onBackdropClick={() => {
        // 执行中不允许关闭：请求已发出，关掉对话框不会撤销写操作。
        if (!busy) {
          onCancel();
        }
      }}
    >
      <header>
        <h2>{t("write.resetTitle")}</h2>
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
          <span className="mono">{commit.short_oid}</span>
          <span className="confirm-summary" title={commit.summary}>
            {commit.summary}
          </span>
        </p>
        <p className="muted confirm-hint">{t("write.resetTargetHint")}</p>

        <fieldset className={destructive ? "reset-mode-picker destructive" : "reset-mode-picker"}>
          <legend className="muted">{t("write.resetModeLegend")}</legend>
          {MODES.map((option) => (
            <label
              className={option === "hard" ? "reset-mode-option danger-text" : "reset-mode-option"}
              key={option}
            >
              <input
                type="radio"
                name="reset-mode"
                value={option}
                checked={mode === option}
                disabled={busy}
                onChange={() => changeMode(option)}
              />
              <span>{modeLabel[option]}</span>
              <span className="reset-mode-desc muted">{modeHint[option]}</span>
            </label>
          ))}
        </fieldset>

        {destructive && (
          <div className="reset-hard-confirm">
            <p className="danger-text confirm-hint">{t("write.resetHardHint")}</p>
            <label className="reset-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              {t("write.resetHardAck")}
            </label>
          </div>
        )}
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
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button
          className={destructive ? "danger" : "primary"}
          onClick={() => void execute()}
          disabled={blocked}
        >
          {busy ? t("write.resetBusy") : t("write.resetConfirm")}
        </button>
      </footer>
    </Modal>
  );
}
