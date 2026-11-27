import { useState } from "react";
import { useI18n } from "../../i18n";
import { shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
import { primaryModifierLabel } from "../../shared/platform";
import type { RepoStateDto } from "../../shared/types";
import { ComparePresets } from "./ComparePresetsDialog";
import { CompareSlotMenu } from "./CompareSlotMenu";
import { isCommitOid } from "./comparePresets";
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
        <CompareSlotMenu
          slotTitle={title}
          worktreeSelected={worktree}
          worktreeBlocked={worktreeBlocked}
          onPickWorktree={onPickWorktree}
        />
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
  onResolvePending,
}: CompareBarProps) {
  const { t } = useI18n();
  const [presetDialog, setPresetDialog] = useState<"save" | "list" | null>(null);
  const worktree = worktreeSlot(t);
  const modifier = primaryModifierLabel();
  const hint = compare
    ? t("compare.hintActive", { modifier })
    : t("compare.hintIdle", { modifier });
  const contextTitle = `${t("compare.headTitle", { oid: repo.head.oid || "—" })}\n${hint}`;
  const saveReason =
    !base || !compare
      ? t("compare.presetNeedBoth")
      : isWorktreeSlot(base) || isWorktreeSlot(compare)
        ? t("compare.presetWorktreeUnsupported")
        : !isCommitOid(base.oid) || !isCommitOid(compare.oid)
          ? t("compare.presetInvalidEndpoint")
          : null;
  return (
    <div className="compare-bar" aria-label={t("compare.barLabel")} title={contextTitle}>
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
      <div className="compare-preset-actions">
        <button
          type="button"
          className="compare-preset-trigger"
          aria-label={saveReason ? `${t("compare.presetSave")}: ${saveReason}` : t("compare.presetSave")}
          title={saveReason ? undefined : t("compare.presetSave")}
          aria-disabled={saveReason !== null}
          data-reason={saveReason ?? undefined}
          aria-haspopup="dialog"
          onClick={() => {
            if (!saveReason) {
              setPresetDialog("save");
            }
          }}
        >
          <span aria-hidden="true">☆</span>
        </button>
        <button
          type="button"
          className="compare-preset-trigger"
          aria-label={t("compare.presetList")}
          title={t("compare.presetList")}
          aria-haspopup="dialog"
          onClick={() => setPresetDialog("list")}
        >
          <span aria-hidden="true">☰</span>
        </button>
      </div>
      {!compare && (
        <div className="compare-hint muted" title={contextTitle}>
          {t("compare.hintCompactIdle", { modifier })}
        </div>
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

      {presetDialog && (
        <ComparePresets
          key={repo.path}
          mode={presetDialog}
          repoPath={repo.path}
          base={base}
          compare={compare}
          onClose={() => setPresetDialog(null)}
          onApply={(preset) => {
            onSetSlot("base", preset.base);
            onSetSlot("compare", preset.compare);
          }}
        />
      )}
    </div>
  );
}
