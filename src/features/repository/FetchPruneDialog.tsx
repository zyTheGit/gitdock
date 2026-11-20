import { useI18n } from "../../i18n";
import { RemoteWriteDialog } from "../write/RemoteWriteDialog";

interface FetchPruneDialogProps {
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/**
 * 「Fetch 并清理失效远程」（ADR-0028）：`git fetch --prune`。
 * 走统一写确认流程：Gate 结论通过且用户确认后才执行。
 */
export function FetchPruneDialog({ onCancel, onMutated }: FetchPruneDialogProps) {
  const { t } = useI18n();
  return (
    <RemoteWriteDialog
      request={{ kind: "fetch_prune" }}
      title={t("graph.fetchPrune")}
      target={t("graph.fetchPruneTarget")}
      hint={t("graph.fetchPruneHint")}
      confirmLabel={t("graph.fetchPruneConfirm")}
      busyLabel={t("graph.fetchPruning")}
      onCancel={onCancel}
      onMutated={onMutated}
    />
  );
}
