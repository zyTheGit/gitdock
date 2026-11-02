import { useState } from "react";
import { Modal } from "../../shared/Modal";
import { Select } from "../../shared/Select";
import type { RefDto } from "../../shared/types";

interface BranchCompareDialogProps {
  branches: RefDto[];
  headBranch: string | null;
  initialBase?: string | null;
  initialCompare?: string | null;
  onCancel: () => void;
  onConfirm: (base: RefDto, compare: RefDto) => void;
}

function pickName(
  branches: RefDto[],
  preferred: string | null | undefined,
  excluded?: string,
): string {
  if (preferred && preferred !== excluded && branches.some((b) => b.short_name === preferred)) {
    return preferred;
  }
  return branches.find((b) => b.short_name !== excluded)?.short_name ?? "";
}

/** 从本地分支中选择 Base / Compare；默认 Base 为当前分支。 */
export function BranchCompareDialog({
  branches,
  headBranch,
  initialBase,
  initialCompare,
  onCancel,
  onConfirm,
}: BranchCompareDialogProps) {
  const [baseName, setBaseName] = useState(() => pickName(branches, initialBase ?? headBranch));
  const [compareName, setCompareName] = useState(() =>
    pickName(branches, initialCompare, baseName || undefined),
  );

  const base = branches.find((branch) => branch.short_name === baseName);
  const compare = branches.find((branch) => branch.short_name === compareName);
  const same = baseName === compareName;
  const options = branches.map((branch) => ({
    value: branch.short_name,
    label: branch.is_head ? `${branch.short_name}（当前）` : branch.short_name,
  }));

  return (
    <Modal className="confirm-dialog branch-compare-dialog">
      <header>
        <h2>对比分支</h2>
        <button className="detail-close" onClick={onCancel} aria-label="关闭分支对比">
          ×
        </button>
      </header>

      <section>
        <label className="branch-compare-field">
          Base（基准）
          <Select
            block
            value={baseName}
            options={options}
            onChange={(event) => setBaseName(event.target.value)}
          />
        </label>
        <label className="branch-compare-field">
          Compare（对比）
          <Select
            block
            value={compareName}
            options={options}
            onChange={(event) => setCompareName(event.target.value)}
          />
        </label>
        <p className="muted confirm-hint">
          默认按三点 diff 比较（Base 与 Compare 的共同祖先 → Compare），可在对比视图切换为两点快照。
        </p>
        {same && <p className="danger-text">Base 与 Compare 不能是同一分支。</p>}
        {base && compare && !same && base.commit_oid === compare.commit_oid && (
          <p className="muted confirm-hint">两个分支当前指向同一提交，对比结果将为空。</p>
        )}
      </section>

      <footer>
        <button onClick={onCancel}>取消</button>
        <button
          className="primary"
          disabled={!base || !compare || same}
          onClick={() => {
            if (base && compare) {
              onConfirm(base, compare);
            }
          }}
        >
          开始对比
        </button>
      </footer>
    </Modal>
  );
}
