import { useCallback, useState } from "react";
import { StashDialog } from "../features/staging/StashDialog";

interface UseStashActionsParams {
  writeDisabled: boolean;
  onMutated: (message: string) => Promise<void>;
}

/** stash 面板的全局入口：StagingView 与分支切换确认框共用同一个对话框。 */
export function useStashActions({ writeDisabled, onMutated }: UseStashActionsParams) {
  const [open, setOpen] = useState(false);

  const openStash = useCallback(() => {
    if (!writeDisabled) {
      setOpen(true);
    }
  }, [writeDisabled]);

  const dialog = open ? (
    <StashDialog
      writeDisabled={writeDisabled}
      onClose={() => setOpen(false)}
      onMutated={onMutated}
    />
  ) : null;

  return { openStash, dialog };
}