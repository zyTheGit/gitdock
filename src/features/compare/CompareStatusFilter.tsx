import { useI18n } from "../../i18n";
import { STATUS_LETTER, statusLabelKey } from "../../shared/fileStatus";
import type { FileStatus } from "../../shared/types";

export type CompareStatusFilterValue = "all" | "added" | "modified" | "deleted" | "renamed";

const BUCKETS = ["all", "added", "modified", "deleted", "renamed"] as const;

// copied 归入 R、type_changed 归入 M：两者在双槽对比里都很少见，
// 单独成档会挤占筛选栏，且用户按「重命名 / 修改」找文件时预期能看到它们。
const BUCKET_STATUS: Record<Exclude<CompareStatusFilterValue, "all">, FileStatus> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
};

export function matchesStatusBucket(status: FileStatus, bucket: CompareStatusFilterValue): boolean {
  switch (bucket) {
    case "all":
      return true;
    case "added":
      return status === "added";
    case "deleted":
      return status === "deleted";
    case "renamed":
      return status === "renamed" || status === "copied";
    case "modified":
      return status === "modified" || status === "type_changed";
  }
}

/** 对比结果的文件状态筛选：全部 / A / M / D / R。 */
export function CompareStatusFilter({
  value,
  onChange,
}: {
  value: CompareStatusFilterValue;
  onChange: (value: CompareStatusFilterValue) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="compare-status-filter" role="group" aria-label={t("compare.statusFilter")}>
      {BUCKETS.map((bucket) => {
        const label =
          bucket === "all" ? t("compare.filterAll") : STATUS_LETTER[BUCKET_STATUS[bucket]];
        return (
          <button
            key={bucket}
            type="button"
            className={value === bucket ? "active" : ""}
            aria-pressed={value === bucket}
            title={bucket === "all" ? t("compare.filterAll") : t(statusLabelKey(BUCKET_STATUS[bucket]))}
            onClick={() => onChange(bucket)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
