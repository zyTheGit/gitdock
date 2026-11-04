import { useI18n } from "../../i18n";
import { gateSummaryText, issueText, warningText } from "../../shared/error";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { CommitSummaryDto, GateReportDto, WriteKind } from "../../shared/types";

type DialogKind = Extract<
  WriteKind,
  "cherry_pick" | "revert" | "switch_branch" | "continue_operation" | "abort_operation"
>;

interface ConfirmWriteDialogProps {
  kind: DialogKind;
  commit?: CommitSummaryDto;
  branch?: string;
  /** continue/abort 对应的中断类型；存在时不显示提交目标行。 */
  interruption?: "cherry_pick" | "revert";
  gate: GateReportDto | null;
  gateError?: string;
  /** 正在重新检查（例如改选父提交）；期间不得放行执行。 */
  validating: boolean;
  /** merge commit 的基线父序号（1 起始），由写流程维护。 */
  mainline: number;
  onMainlineChange: (mainline: number) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** 分支切换因工作区不干净被拒时，引导用户先手动 stash。 */
  onOpenStash?: () => void;
}

/** 写操作确认框：先展示 Gate 结论，Gate 未通过时禁止执行。 */
export function ConfirmWriteDialog({
  kind,
  commit,
  branch,
  interruption,
  gate,
  gateError,
  validating,
  mainline,
  onMainlineChange,
  busy,
  onCancel,
  onConfirm,
  onOpenStash,
}: ConfirmWriteDialogProps) {
  const { t } = useI18n();
  useEscClose(onCancel, busy || validating);

  const actionLabel: Record<DialogKind, string> = {
    cherry_pick: t("write.labelCherryPick"),
    revert: t("write.labelRevert"),
    switch_branch: t("write.labelSwitchBranch"),
    continue_operation: t("write.labelContinueOperation"),
    abort_operation: t("write.labelAbortOperation"),
  };
  const label = actionLabel[kind];
  const actionHint: Record<DialogKind, string> = {
    cherry_pick: t("write.actionHintCherryPick"),
    revert: t("write.actionHintRevert"),
    switch_branch: t("write.actionHintSwitchBranch"),
    continue_operation: t("write.actionHintContinue"),
    abort_operation: t("write.actionHintAbort"),
  };
  const confirmLabel: Partial<Record<DialogKind, string>> = {
    continue_operation: t("write.confirmContinue"),
    abort_operation: t("write.confirmAbort"),
  };
  const dialogTitle: Partial<Record<DialogKind, string>> = {
    continue_operation: t("write.titleContinue"),
    abort_operation: t("write.titleAbort"),
  };
  const interruptionLabel: Record<"cherry_pick" | "revert", string> = {
    cherry_pick: t("write.labelCherryPick"),
    revert: t("write.labelRevert"),
  };
  const blocked = Boolean(gateError) || !gate?.ok || validating;
  const destructive = kind === "abort_operation";
  const dirtySwitch =
    kind === "switch_branch" &&
    Boolean(onOpenStash) &&
    Boolean(gate?.issues.some((issue) => issue.code === "gate_worktree_dirty"));

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{dialogTitle[kind] ?? t("write.titleConfirm", { label })}</h2>
        <button className="detail-close" onClick={onCancel} aria-label={t("write.closeDialogAria")}>
          ×
        </button>
      </header>

      <section>
        {interruption ? (
          <p className="confirm-target">
            <span className="muted">{t("write.interruptedOperation")}</span>
            <span className="mono">{interruptionLabel[interruption]}</span>
          </p>
        ) : commit ? (
          <p className="confirm-target">
            <span className="mono">{commit.short_oid}</span>
            <span className="confirm-summary" title={commit.summary}>
              {commit.summary}
            </span>
          </p>
        ) : (
          <p className="confirm-target">
            <span className="mono">{branch ?? ""}</span>
          </p>
        )}
        <p className={destructive ? "danger-text confirm-hint" : "muted confirm-hint"}>
          {actionHint[kind]}
        </p>
        {dirtySwitch && (
          <button className="link" onClick={onOpenStash} disabled={busy}>
            {t("write.stashBeforeSwitch")}
          </button>
        )}
      </section>

      <section className="gate-report">
        <h3>{t("write.gateTitle")}</h3>
        {gateError ? (
          <p className="danger-text">{gateError}</p>
        ) : !gate ? (
          <p className="muted">{t("write.gateChecking")}</p>
        ) : gate.ok ? (
          <p className="gate-ok">{gateSummaryText(gate)}</p>
        ) : (
          <>
            <p className="danger-text">{t("write.gateFailedPrefix")}</p>
            <ul className="gate-issues">
              {gate.issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
              ))}
            </ul>
          </>
        )}
        {validating && gate && <p className="muted">{t("write.gateRechecking")}</p>}
        {gate?.warnings.map((warning) => (
          <p className="gate-warning" key={`${warning.code}:${warning.message}`}>
            {warningText(warning)}
          </p>
        ))}
        {gate && gate.affected_paths.length > 0 && (
          <div className="gate-affected">
            <p className="muted">
              {gate.affected_total > gate.affected_paths.length
                ? t("write.affectedFilesTruncated", {
                    n: gate.affected_total,
                    m: gate.affected_paths.length,
                  })
                : t("write.affectedFiles", { n: gate.affected_total })}
            </p>
            <ul className="gate-paths">
              {gate.affected_paths.map((path) => (
                <li className="mono" key={path}>
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
        {gate?.is_merge_commit &&
          (gate.parents.length > 0 ? (
            <fieldset className="mainline-picker">
              <legend className="muted">{t("write.mainlineLegend")}</legend>
              {gate.parents.map((parent, index) => {
                const ordinal = index + 1;
                return (
                  <label className="mainline-option" key={parent.oid}>
                    <input
                      type="radio"
                      name="write-mainline"
                      value={ordinal}
                      checked={mainline === ordinal}
                      disabled={busy}
                      onChange={() => onMainlineChange(ordinal)}
                    />
                    <span>{t("write.mainlineParent", { n: ordinal })}</span>
                    <span className="mono">{parent.short_oid}</span>
                    <span className="confirm-summary" title={parent.summary}>
                      {parent.summary || t("write.parentNoSummary")}
                    </span>
                  </label>
                );
              })}
              <p className="muted">{t("write.parentsSummary", { n: gate.parents.length })}</p>
            </fieldset>
          ) : (
            <p className="muted">{t("write.mergeNoParents")}</p>
          ))}
      </section>

      <footer>
        <button onClick={onCancel} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="primary" onClick={onConfirm} disabled={blocked || busy}>
          {busy
            ? t("write.executing")
            : (confirmLabel[kind] ?? t("write.confirmExecute", { label }))}
        </button>
      </footer>
    </Modal>
  );
}
