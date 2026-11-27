import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import { Modal } from "../../shared/Modal";
import type { GateIssueDto, GateReportDto } from "../../shared/types";
import { GateReportView } from "../write/GateReportView";

interface DiscardConfirmDialogProps {
  /** 待丢弃的仓库内相对路径（当前勾选或右键的那一个）。 */
  paths: string[];
  /** 其中属于未跟踪文件的路径；后端按「删除文件」处理（ADR 0026）。 */
  untrackedPaths: string[];
  /** 确认后经 Gate 得到的报告；未确认前为 null。 */
  gate: GateReportDto | null;
  /** Gate 未通过时的拒绝原因。 */
  issues: GateIssueDto[] | null;
  /** 执行失败/被拒的说明（含 stderr）。 */
  error: string | null;
  validating: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenStash: () => void;
}

/** 路径清单：按已跟踪/未跟踪分组，长列表内部滚动。 */
function pathGroup(title: string, paths: string[]) {
  return (
    <div>
      <p className="muted">{title}</p>
      <ul className="gate-paths">
        {paths.map((path) => (
          <li className="mono" key={path}>
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 丢弃未暂存改动的强破坏性确认框（ADR 0026 §2.4）：红色危险按钮、列出将被
 * 永久删除的路径、明示无法经 reflog 恢复并引导先 Stash。Esc/遮罩点击取消，
 * 执行中不响应。
 */
export function DiscardConfirmDialog({
  paths,
  untrackedPaths,
  gate,
  issues,
  error,
  validating,
  busy,
  onCancel,
  onConfirm,
  onOpenStash,
}: DiscardConfirmDialogProps) {
  const { t } = useI18n();
  const working = validating || busy;
  const workingRef = useRef(working);
  workingRef.current = working;

  // Esc 分层：本框是最内层，捕获阶段消费 Esc 只关闭自己（执行中只吞掉不关闭），
  // 避免连带触发暂存区视图退出。
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

  const untrackedSet = new Set(untrackedPaths);
  const tracked = paths.filter((path) => !untrackedSet.has(path));
  const untracked = paths.filter((path) => untrackedSet.has(path));
  // 破坏性提示已由常驻文案完整说明，Gate 的同类 warning 不再重复一遍。
  const confirmLabel = busy
    ? t("staging.discardSubmitting")
    : validating
      ? t("staging.discardValidating")
      : t("staging.discardConfirm");

  return (
    <Modal
      className="confirm-dialog discard-dialog"
      onBackdropClick={working ? undefined : onCancel}
    >
      <header>
        <h2>{t("staging.discardConfirmTitle")}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={working}
          aria-label={t("staging.discardCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="danger-text confirm-hint">{t("staging.discardConfirmHint")}</p>
        <div className="discard-paths">
          <p className="muted">{t("staging.discardPathsTitle", { n: paths.length })}</p>
          {tracked.length > 0 &&
            pathGroup(t("staging.discardGroupTracked", { n: tracked.length }), tracked)}
          {untracked.length > 0 &&
            pathGroup(t("staging.discardGroupUntracked", { n: untracked.length }), untracked)}
        </div>
      </section>

      {(gate || issues) && (
        <GateReportView
          gate={gate}
          gateError={null}
          validating={validating}
          issues={issues}
          hideWarnings={["discard_destructive"]}
        />
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
