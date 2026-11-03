import { useI18n } from "../../i18n";
import { shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
import { primaryModifierLabel } from "../../shared/platform";
import type { RepoStateDto } from "../../shared/types";
import type { CompareSide, CompareSlot } from "./useCompare";

interface CompareBarProps {
  repo: RepoStateDto;
  base: CompareSlot | null;
  compare: CompareSlot | null;
  pending: CompareSlot | null;
  invalidRef: boolean;
  onClear: (side: CompareSide) => void;
  onSwap: () => void;
  onResolvePending: (side: CompareSide | null) => void;
}

function Slot({
  title,
  slot,
  invalid,
  onClear,
}: {
  title: string;
  slot: CompareSlot | null;
  invalid: boolean;
  onClear: () => void;
}) {
  const { t } = useI18n();
  if (!slot) {
    return (
      <div className="compare-slot empty">
        <span className="compare-slot-title">{title}</span>
        <span className="muted">{t("compare.slotUnselected")}</span>
      </div>
    );
  }
  return (
    <div className={invalid ? "compare-slot invalid" : "compare-slot"}>
      <span className="compare-slot-title">{title}</span>
      <span className="compare-slot-label" title={slot.oid}>
        {slot.label}
      </span>
      <span className="compare-slot-oid mono">{shortOid(slot.oid)}</span>
      <button
        className="compare-slot-clear"
        onClick={onClear}
        aria-label={t("compare.clearSlot", { title })}
      >
        ×
      </button>
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
  onSwap,
  onResolvePending,
}: CompareBarProps) {
  const { t } = useI18n();
  return (
    <div className="compare-bar" aria-label={t("compare.barLabel")}>
      <Slot
        title={t("compare.slotBase")}
        slot={base}
        invalid={invalidRef}
        onClear={() => onClear("base")}
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
        onClear={() => onClear("compare")}
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
