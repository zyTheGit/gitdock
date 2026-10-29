import { shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
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
  if (!slot) {
    return (
      <div className="compare-slot empty">
        <span className="compare-slot-title">{title}</span>
        <span className="muted">未选择</span>
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
      <button className="compare-slot-clear" onClick={onClear} aria-label={`清空 ${title}`}>
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
  return (
    <div className="compare-bar" aria-label="对比选择">
      <Slot title="Base" slot={base} invalid={invalidRef} onClear={() => onClear("base")} />
      <button
        className="compare-swap"
        onClick={onSwap}
        disabled={!base || !compare}
        title="交换 Base 与 Compare"
      >
        ⇄
      </button>
      <Slot
        title="Compare"
        slot={compare}
        invalid={invalidRef}
        onClear={() => onClear("compare")}
      />
      <div className="compare-hint muted">
        {compare
          ? "Compare 相对 Base 共同祖先的改动 · Ctrl+点击可替换"
          : "Ctrl+点击提交填入 Compare，或用「对比分支…」按分支选择"}
        <span className="mono compare-head">HEAD {repo.head.oid ? shortOid(repo.head.oid) : "—"}</span>
      </div>

      {pending && (
        <Modal className="compare-modal">
          <h3>替换哪一侧？</h3>
          <p className="muted">
            新选择 <strong>{pending.label}</strong>（<span className="mono">{shortOid(pending.oid)}</span>）
          </p>
          <div className="compare-modal-actions">
            <button className="primary" onClick={() => onResolvePending("base")}>
              替换 Base
            </button>
            <button onClick={() => onResolvePending("compare")}>替换 Compare</button>
            <button onClick={() => onResolvePending(null)}>取消</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
