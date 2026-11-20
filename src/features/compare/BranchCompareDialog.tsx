import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { Select, type SelectGroup } from "../../shared/Select";
import { useEscClose } from "../../shared/useEscClose";
import type { RefDto, RefKind } from "../../shared/types";

interface BranchCompareDialogProps {
  /** 可选引用：本地分支、远程分支与标签（按 kind 分组展示）。 */
  refs: RefDto[];
  headBranch: string | null;
  initialBase?: string | null;
  initialCompare?: string | null;
  onCancel: () => void;
  onConfirm: (base: RefDto, compare: RefDto) => void;
}

/** 按 full_name 选值：同名本地分支与标签靠 full_name 区分。 */
function pickKey(
  refs: RefDto[],
  preferred: string | null | undefined,
  excluded?: string,
): string {
  if (preferred) {
    const match =
      refs.find((ref) => ref.kind === "local_branch" && ref.short_name === preferred) ??
      refs.find((ref) => ref.full_name === preferred || ref.short_name === preferred);
    if (match && match.full_name !== excluded) {
      return match.full_name;
    }
  }
  return refs.find((ref) => ref.full_name !== excluded)?.full_name ?? "";
}

/** 从本地分支、远程分支或标签中选择 Base / Compare；默认 Base 为当前分支。 */
export function BranchCompareDialog({
  refs,
  headBranch,
  initialBase,
  initialCompare,
  onCancel,
  onConfirm,
}: BranchCompareDialogProps) {
  const { t } = useI18n();
  // 只能对比能解析到提交的引用（指向 blob/tree 的标签不参与）。
  const usable = useMemo(() => refs.filter((ref) => Boolean(ref.commit_oid)), [refs]);
  const [baseKey, setBaseKey] = useState(() => pickKey(usable, initialBase ?? headBranch));
  const [compareKey, setCompareKey] = useState(() =>
    pickKey(usable, initialCompare, baseKey || undefined),
  );

  useEscClose(onCancel);

  const base = usable.find((ref) => ref.full_name === baseKey);
  const compare = usable.find((ref) => ref.full_name === compareKey);
  const same = baseKey !== "" && baseKey === compareKey;
  const groups = useMemo<SelectGroup[]>(() => {
    const build = (label: string, kind: RefKind): SelectGroup => ({
      label,
      options: usable
        .filter((ref) => ref.kind === kind)
        .map((ref) => ({
          value: ref.full_name,
          label: ref.is_head
            ? t("compare.currentBranchOption", { branch: ref.short_name })
            : ref.short_name,
        })),
    });
    return [
      build(t("compare.groupLocal"), "local_branch"),
      build(t("compare.groupRemote"), "remote_branch"),
      build(t("compare.groupTags"), "tag"),
    ].filter((group) => group.options.length > 0);
  }, [usable, t]);

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
            value={baseKey}
            groups={groups}
            onChange={(event) => setBaseKey(event.target.value)}
          />
        </label>
        <label className="branch-compare-field">
          {t("compare.fieldCompare")}
          <Select
            block
            value={compareKey}
            groups={groups}
            onChange={(event) => setCompareKey(event.target.value)}
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
