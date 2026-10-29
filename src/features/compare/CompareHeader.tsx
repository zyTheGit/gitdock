import type { CompareResultDto } from "../../shared/types";
import type { CompareSlot } from "./useCompare";

interface CompareHeaderProps {
  base: CompareSlot;
  compare: CompareSlot;
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  result: CompareResultDto | null;
  totalAdd: number;
  totalDel: number;
  onBack: () => void;
}

const MODE_LABEL: Record<CompareResultDto["mode"], string> = {
  three_dot: "三点 diff",
  two_dot: "两点快照",
  two_dot_fallback: "两点快照降级",
};

export function CompareHeader({
  base,
  compare,
  twoDot,
  onTwoDotChange,
  result,
  totalAdd,
  totalDel,
  onBack,
}: CompareHeaderProps) {
  return (
    <header className="compare-header">
      <div>
        <h2>{twoDot ? "Compare 与 Base 的完整快照差异" : "Compare 相对 Base 共同祖先的改动"}</h2>
        <div className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
          {base.label} ({base.oid.slice(0, 8)}) → {compare.label} ({compare.oid.slice(0, 8)})
        </div>
      </div>
      <div className="compare-meta">
        <div className="diff-mode" role="group" aria-label="对比模式">
          <button
            className={twoDot ? "" : "active"}
            onClick={() => onTwoDotChange(false)}
            title="git diff base...compare：只显示 Compare 相对共同祖先的改动"
          >
            三点 diff
          </button>
          <button
            className={twoDot ? "active" : ""}
            onClick={() => onTwoDotChange(true)}
            title="git diff base compare：显示两个提交的完整快照差异"
          >
            两点快照
          </button>
        </div>
        <span className={result?.mode === "two_dot_fallback" ? "tag warn" : "tag"}>
          {result ? MODE_LABEL[result.mode] : "三点 diff"}
        </span>
        {result && (
          <>
            <span className="muted">
              左侧 Base 独有 <strong>{result.base_only}</strong> · 右侧 Compare 独有{" "}
              <strong>{result.compare_only}</strong>
            </span>
            <span className="diff-add">+{totalAdd}</span>
            <span className="diff-del">-{totalDel}</span>
          </>
        )}
        <button onClick={onBack}>查看图谱</button>
      </div>
    </header>
  );
}
