import { useState } from "react";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  const [baseName, setBaseName] = useState(() => pickName(branches, initialBase ?? headBranch));
  const [compareName, setCompareName] = useState(() =>
    pickName(branches, initialCompare, baseName || undefined),
  );

  const base = branches.find((branch) => branch.short_name === baseName);
  const compare = branches.find((branch) => branch.short_name === compareName);
  const same = baseName === compareName;
  const options = branches.map((branch) => ({
    value: branch.short_name,
    label: branch.is_head
      ? t("compare.currentBranchOption", { branch: branch.short_name })
      : branch.short_name,
  }));

  return (
    <Modal className="confirm-dialog branch-compare-dialog">
      <header>
        <h2>{t("compare.dialogTitle")}</h2>
        <button className="detail-close" onClick={onCancel} aria-label={t("compare.closeDialog")}>
          ×
        </button>
      </header>

      <section>
        <label className="branch-compare-field">
          {t("compare.fieldBase")}
          <Select
            block
            value={baseName}
            options={options}
            onChange={(event) => setBaseName(event.target.value)}
          />
        </label>
        <label className="branch-compare-field">
          {t("compare.fieldCompare")}
          <Select
            block
            value={compareName}
            options={options}
            onChange={(event) => setCompareName(event.target.value)}
          />
        </label>
        <p className="muted confirm-hint">{t("compare.modeHint")}</p>
        {same && <p className="danger-text">{t("compare.sameBranchError")}</p>}
        {base && compare && !same && base.commit_oid === compare.commit_oid && (
          <p className="muted confirm-hint">{t("compare.sameCommitHint")}</p>
        )}
      </section>

      <footer>
        <button onClick={onCancel}>{t("compare.cancel")}</button>
        <button
          className="primary"
          disabled={!base || !compare || same}
          onClick={() => {
            if (base && compare) {
              onConfirm(base, compare);
            }
          }}
        >
          {t("compare.startCompare")}
        </button>
      </footer>
    </Modal>
  );
}
