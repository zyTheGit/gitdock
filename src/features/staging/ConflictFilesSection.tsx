import { useI18n } from "../../i18n";
import type { InterruptionKind, StagingStatusDto } from "../../shared/types";
import { ConflictResolveDialog } from "./ConflictResolveDialog";
import { conflictSideLabels } from "./conflictSides";
import { useConflictFlow, type ConflictAction } from "./useConflictFlow";

interface ConflictFilesSectionProps {
  /** 冲突路径清单（`StagingStatusDto.conflicted_files`）。 */
  paths: string[];
  /** 中断类型（`repo.interruption.kinds`）：只影响 ours / theirs 的文案语义。 */
  kinds: InterruptionKind[];
  disabled: boolean;
  /** 已有写操作在跑（stage/unstage/提交/静默重载）。 */
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  reload: () => Promise<StagingStatusDto | null>;
  onMutated: (message: string) => Promise<void>;
  onOpenTerminal: () => void;
}

/**
 * 暂存区冲突分组（ADR-0033）：每行保留状态徽标与路径，并给出「整文件取一侧」与
 * 「标记已解决」三个入口。动作一律先开确认框，成功后由 hook 重读状态并走既有刷新
 * 通道更新横幅；本组件不自动 continue / abort。
 */
export function ConflictFilesSection({
  paths,
  kinds,
  disabled,
  isBusy,
  setBusy,
  setError,
  reload,
  onMutated,
  onOpenTerminal,
}: ConflictFilesSectionProps) {
  const { t } = useI18n();
  const flow = useConflictFlow({ disabled, isBusy, setBusy, setError, reload, onMutated });
  const sides = conflictSideLabels(t, kinds);
  const anyBusy = flow.busyTarget !== null;
  const running = (path: string, action: ConflictAction) =>
    flow.busyTarget?.path === path && flow.busyTarget.action === action;

  return (
    <>
      <section className="staging-group staging-conflicts" aria-label={t("staging.conflictFiles")}>
        <header className="staging-group-head">
          <strong>{t("staging.conflictFiles")}</strong>
          <span className="muted">{paths.length}</span>
        </header>
        <ul className="staging-list">
          {paths.map((path) => (
            <li key={path} className="staging-conflict-row">
              <span className="file-status file-status-conflicted">U</span>
              <span className="staging-path mono" title={path}>
                {path}
              </span>
              <div className="conflict-row-actions">
                <button
                  className="danger"
                  disabled={disabled || anyBusy}
                  onClick={() => flow.open(path, "resolve_conflict_ours")}
                >
                  {running(path, "resolve_conflict_ours")
                    ? t("staging.conflictOverwriteBusy")
                    : t("staging.conflictResolveOurs", { side: sides.ours })}
                </button>
                <button
                  disabled={disabled || anyBusy}
                  onClick={() => flow.open(path, "resolve_conflict_theirs")}
                >
                  {running(path, "resolve_conflict_theirs")
                    ? t("staging.conflictOverwriteBusy")
                    : t("staging.conflictResolveTheirs", { side: sides.theirs })}
                </button>
                <button
                  disabled={disabled || anyBusy}
                  onClick={() => flow.open(path, "mark_conflict_resolved")}
                >
                  {running(path, "mark_conflict_resolved")
                    ? t("staging.conflictMarkBusy")
                    : t("staging.conflictMarkResolved")}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="staging-conflict-hint muted">{t("staging.conflictHint")}</p>
        <button onClick={onOpenTerminal} disabled={anyBusy}>
          {t("staging.openTerminalForConflicts")}
        </button>
      </section>

      {flow.pending && (
        <ConflictResolveDialog
          target={flow.pending}
          stage={flow.stage}
          kinds={kinds}
          markers={flow.markers}
          gate={flow.gate}
          issues={flow.issues}
          error={flow.error}
          validating={flow.validating}
          busy={flow.busy}
          onCancel={flow.cancel}
          onConfirm={() => void flow.confirm()}
        />
      )}
    </>
  );
}
