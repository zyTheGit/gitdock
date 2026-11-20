import { useI18n } from "../../i18n";
import { shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
import { primaryModifierLabel } from "../../shared/platform";
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
  return (
    <div className={slot ? (invalid ? "compare-slot invalid" : "compare-slot") : "compare-slot empty"}>
      <span className="compare-slot-title">{title}</span>
      {slot ? (
        <>
          <span className="compare-slot-label" title={slot.oid}>
            {slot.label}
          </span>
          {!worktree && <span className="compare-slot-oid mono">{shortOid(slot.oid)}</span>}
        </>
      ) : (
        <span className="muted">{t("compare.slotUnselected")}</span>
      )}
      <button
        className="compare-slot-worktree"
        onClick={onPickWorktree}
        disabled={worktreeBlocked || worktree}
        title={t("compare.useWorktree")}
      >
        {t("compare.worktreeShort")}
      </button>
      {slot && (
        <button
          className="compare-slot-clear"
          onClick={onClear}
          aria-label={t("compare.clearSlot", { title })}
        >
          ×
        </button>
      )}
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
  onResolvePending,
}: CompareBarProps) {
  const { t } = useI18n();
  const worktree = worktreeSlot(t);
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
        className="compare-swap"
        onClick={onSwap}
        disabled={!base || !compare}
        title={t("compare.swapSides")}
      >
        ⇄
      </button>
      <Slot
        title={t("compare.slotCompare")}
        slot={compare}
        invalid={invalidRef}
        worktreeBlocked={isWorktreeSlot(base)}
        onClear={() => onClear("compare")}
        onPickWorktree={() => onSetSlot("compare", worktree)}
      />
      <div className="compare-hint muted">
        {compare
          ? t("compare.hintActive", { modifier: primaryModifierLabel() })
          : t("compare.hintIdle", { modifier: primaryModifierLabel() })}
        <span className="mono compare-head">HEAD {repo.head.oid ? shortOid(repo.head.oid) : "—"}</span>
      </div>

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
