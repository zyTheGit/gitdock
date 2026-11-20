import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { gateSummaryText, issueText, warningText } from "../../shared/error";
import { Modal } from "../../shared/Modal";
import type {
  GateIssueDto,
  GateReportDto,
  InterruptionKind,
  WarningDto,
} from "../../shared/types";
import { conflictSideLabels } from "./conflictSides";
import type { ConflictStage, ConflictTarget } from "./useConflictFlow";

interface ConflictResolveDialogProps {
  /** 目标文件与动作（三个受限 kind 之一）。 */
  target: ConflictTarget;
  /** `markers` 阶段表示文件仍含冲突标记，需要第二次确认。 */
  stage: ConflictStage;
  /** 中断类型：决定 ours / theirs 的语义文案（rebase 反转）。 */
  kinds: InterruptionKind[];
  /** `conflict_markers_present` 警告（Gate 非阻断）。 */
  markers: WarningDto[];
  gate: GateReportDto | null;
  issues: GateIssueDto[] | null;
  error: string | null;
  validating: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 警告里的 path 参数；缺失时回落到目标路径。 */
function warningPath(warning: WarningDto, fallback: string): string {
  const path = warning.args?.path;
  return typeof path === "string" && path.length > 0 ? path : fallback;
}

/**
 * 冲突解决确认框（ADR-0033）：ours / theirs 是覆盖工作区的动作，必须写明保留哪一侧、
 * 另一侧的冲突块内容会被丢弃，且索引保持不变；`mark_conflict_resolved` 在 Gate
 * 报告残留冲突标记时切到第二段确认，执行前再要一次明确同意。Esc / 遮罩取消，
 * 执行中不响应。
 */
export function ConflictResolveDialog({
  target,
  stage,
  kinds,
  markers,
  gate,
  issues,
  error,
  validating,
  busy,
  onCancel,
  onConfirm,
}: ConflictResolveDialogProps) {
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

  const sides = conflictSideLabels(t, kinds);
  const { action, path } = target;
  const markerStage = stage === "markers";
  const overwrite = action !== "mark_conflict_resolved";
  const markerPaths = [...new Set(markers.map((warning) => warningPath(warning, path)))];

  const title = markerStage
    ? t("staging.conflictMarkerTitle")
    : action === "resolve_conflict_ours"
      ? t("staging.conflictTitleOurs")
      : action === "resolve_conflict_theirs"
        ? t("staging.conflictTitleTheirs")
        : t("staging.conflictTitleMark");
  const confirmLabel = validating
    ? t("staging.conflictChecking")
    : busy
      ? t("staging.conflictExecuting")
      : markerStage
        ? t("staging.conflictMarkerConfirm")
        : action === "resolve_conflict_ours"
          ? t("staging.conflictConfirmOurs")
          : action === "resolve_conflict_theirs"
            ? t("staging.conflictConfirmTheirs")
            : t("staging.conflictConfirmMark");

  return (
    <Modal className="confirm-dialog conflict-dialog" onBackdropClick={working ? undefined : onCancel}>
      <header>
        <h2>{title}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={working}
          aria-label={t("staging.conflictCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className={markerStage ? "danger-text confirm-hint" : "confirm-hint"}>
          {markerStage
            ? t("staging.conflictMarkerHint")
            : overwrite
              ? t("staging.conflictOverwriteHint", { path })
              : t("staging.conflictMarkHint", { path })}
        </p>
        {overwrite && !markerStage && (
          <p className="conflict-side-line">
            <strong>
              {action === "resolve_conflict_ours"
                ? t("staging.conflictKeepOurs", { side: sides.ours })
                : t("staging.conflictKeepTheirs", { side: sides.theirs })}
            </strong>
          </p>
        )}
        {sides.inverted && overwrite && (
          <p className="gate-warning">{t("staging.conflictRebaseNote")}</p>
        )}
        <div className="discard-paths">
          <div>
            <p className="muted">{t("staging.conflictTargetTitle")}</p>
            <ul className="gate-paths">
              <li className="mono">{path}</li>
            </ul>
          </div>
        </div>
        {markerStage && markerPaths.length > 0 && (
          <div className="discard-paths">
            <div>
              <p className="muted">
                {t("staging.conflictMarkerPathsTitle", { n: markerPaths.length })}
              </p>
              <ul className="gate-paths">
                {markerPaths.map((item) => (
                  <li className="mono" key={item}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {(issues || (gate?.ok && !markerStage) || markers.length > 0) && (
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
          ) : gate?.ok && !markerStage ? (
            <p className="gate-ok">{gateSummaryText(gate)}</p>
          ) : null}
          {markerStage
            ? markers.map((warning) => (
                <p className="gate-warning" key={`${warning.code}:${warning.message}`}>
                  {warningText(warning)}
                </p>
              ))
            : gate?.warnings
                .filter((warning) => warning.code !== "conflict_markers_present")
                .map((warning) => (
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
        <button onClick={onCancel} disabled={working}>
          {t("write.cancel")}
        </button>
        <button
          className={overwrite && !markerStage ? "danger" : undefined}
          onClick={onConfirm}
          disabled={working}
        >
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
