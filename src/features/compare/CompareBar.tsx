import { useI18n } from "../../i18n";
import { shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
import type { RepoStateDto } from "../../shared/types";
import {
  isWorktreeSlot,
  worktreeSlot,
  type CompareSide,
  type CompareSlot,
} from "./useCompare";

interface CompareBarProps {
  repo: RepoStateDto;
  base: CompareSlot | null;
  compare: CompareSlot | null;
  pending: CompareSlot | null;
  invalidRef: boolean;
  onClear: (side: CompareSide) => void;
  onSetSlot: (side: CompareSide, slot: CompareSlot) => void;
  onSwap: () => void;
  onOpenCompare: () => void;
  onResolvePending: (side: CompareSide | null) => void;
}

function Slot({
  title,
  slot,
  invalid,
  worktreeBlocked,
  onClear,
  onPickWorktree,
}: {
  title: string;
  slot: CompareSlot | null;
  invalid: boolean;
  /** 另一侧已是工作区：两侧不能同时指向工作区。 */
  worktreeBlocked: boolean;
  onClear: () => void;
  onPickWorktree: () => void;
}) {
  const { t } = useI18n();
  const worktree = isWorktreeSlot(slot);
  const worktreeTitle = worktree
    ? t("compare.worktreeSelected")
    : worktreeBlocked
      ? t("compare.worktreeBlocked")
      : t("compare.useWorktree");
  return (
    <div
      className={slot ? (invalid ? "compare-slot invalid" : "compare-slot") : "compare-slot empty"}
      role="group"
      aria-label={title}
    >
      <span className="compare-slot-title">{title}</span>
      {slot ? (
        <span className="compare-slot-value" title={worktree ? slot.label : `${slot.label}\n${slot.oid}`}>
          <span className="compare-slot-label">{slot.label}</span>
          {!worktree && (
            <span className="compare-slot-oid mono" title={slot.oid}>
              {shortOid(slot.oid)}
            </span>
          )}
        </span>
      ) : (
        <span className="compare-slot-value muted">
          <span className="compare-slot-label">{t("compare.slotUnselected")}</span>
        </span>
      )}
      <div className="compare-slot-actions">
        {slot && (
          <button
            type="button"
            className="compare-slot-clear"
            onClick={onClear}
            aria-label={t("compare.clearSlot", { title })}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
        <button
          type="button"
          className="compare-slot-worktree"
          disabled={worktree || worktreeBlocked}
          onClick={onPickWorktree}
          aria-label={worktreeTitle}
          title={worktreeTitle}
        >
          {t("compare.worktreeShort")}
        </button>
      </div>
    </div>
  );
}

/** Base / Compare 双槽常显；Ctrl+点击提交依次填入，第三次弹出替换提示。 */
export function CompareBar({
  repo,
  base,
  compare,
  pending,
  invalidRef,
  onClear,
  onSetSlot,
  onSwap,
  onOpenCompare,
  onResolvePending,
}: CompareBarProps) {
  const { t } = useI18n();
  const worktree = worktreeSlot(t);
  void repo;
  return (
    <div className="compare-bar" aria-label={t("compare.barLabel")}>
      <Slot
        title={t("compare.slotBase")}
        slot={base}
        invalid={invalidRef}
        worktreeBlocked={isWorktreeSlot(compare)}
        onClear={() => onClear("base")}
        onPickWorktree={() => onSetSlot("base", worktree)}
      />
      <button
        type="button"
        className="compare-swap"
        onClick={onSwap}
        disabled={!base || !compare}
        title={t("compare.swapSides")}
        aria-label={t("compare.swapSides")}
      >
        <span aria-hidden="true">⇄</span>
      </button>
      <Slot
        title={t("compare.slotCompare")}
        slot={compare}
        invalid={invalidRef}
        worktreeBlocked={isWorktreeSlot(base)}
        onClear={() => onClear("compare")}
        onPickWorktree={() => onSetSlot("compare", worktree)}
      />
      {base && compare && (
        <button
          type="button"
          className="primary compare-open-btn"
          onClick={onOpenCompare}
        >
          {t("compare.openResults")}
        </button>
      )}

      {pending && (
        <Modal className="compare-modal">
          <h3>{t("compare.replaceWhichSide")}</h3>
          <p className="muted">
            {t("compare.newSelection", { label: pending.label, oid: shortOid(pending.oid) })}
          </p>
          <div className="compare-modal-actions">
            <button className="primary" onClick={() => onResolvePending("base")}>
              {t("compare.replaceBase")}
            </button>
            <button onClick={() => onResolvePending("compare")}>
              {t("compare.replaceCompare")}
            </button>
            <button onClick={() => onResolvePending(null)}>{t("compare.cancel")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
