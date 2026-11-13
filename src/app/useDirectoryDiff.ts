import { useCallback } from "react";
import type { CompareSlot } from "../features/compare/useCompare";
import { useI18n } from "../i18n";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { ExternalToolConfig } from "../shared/types";

export function useDirectoryDiff(
  base: CompareSlot | null,
  compare: CompareSlot | null,
  tools: ExternalToolConfig[],
  setError: (message: string | null) => void,
  setToast: (message: string | null) => void,
) {
  const { t } = useI18n();
  return useCallback(
    async (toolIndex: number) => {
      if (!base || !compare) {
        return;
      }
      setError(null);
      try {
        await ipc.launchExternalDirDiff(toolIndex, base.oid, compare.oid);
        const name = tools[toolIndex]?.name ?? t("shell.externalToolFallback");
        setToast(t("shell.externalDirDiffLaunched", { name }));
      } catch (err) {
        setError(errorText(err));
      }
    },
    [base, compare, tools, setError, setToast, t],
  );
}
