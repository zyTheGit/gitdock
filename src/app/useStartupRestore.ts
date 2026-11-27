import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { AppInfoDto, RepoStateDto, SettingsDto } from "../shared/types";
import type { RepoTabsHandle } from "./useRepoTabs";
import type { RepoTabViewState } from "./useRepoTabState";

interface StartupRestoreOptions {
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  open: (path: string) => Promise<unknown>;
  restore: RepoTabsHandle["restore"];
  switchTo: RepoTabViewState["switchTo"];
  applyActiveState: (state: RepoStateDto | null) => Promise<void>;
  reloadSettings: () => Promise<void>;
  resetOverlays: () => void;
  setToast: (message: string | null) => void;
  setError: (message: string | null) => void;
}

/**
 * 启动恢复（ADR-0032）：启动传参优先，其次按 settings 恢复全部标签；
 * 启动不自动打开仓库，失败路径统一落到横幅。
 */
export function useStartupRestore({
  info,
  settings,
  open,
  restore,
  switchTo,
  applyActiveState,
  reloadSettings,
  resetOverlays,
  setToast,
  setError,
}: StartupRestoreOptions) {
  const { t } = useI18n();
  const startupDone = useRef(false);

  useEffect(() => {
    if (startupDone.current || !info || !settings) {
      return;
    }
    startupDone.current = true;
    void (async () => {
      try {
        const startupPath = await ipc.startupRepository().catch(() => null);
        if (startupPath) {
          await open(startupPath);
          return;
        }
        if (!settings.restore_last_repository) {
          return;
        }
        const restored = await restore(settings);
        if (restored.state) {
          switchTo(restored.activeId, true);
          resetOverlays();
          await applyActiveState(restored.state);
          await reloadSettings();
        }
        if (restored.failures.length > 0) {
          setToast(
            t("repository.tabRestoreFailed", {
              count: restored.failures.length,
              paths: restored.failures.join(", "),
            }),
          );
        }
      } catch (err) {
        setError(errorText(err));
      }
    })();
    // 依赖只用于在启动数据落地后触发一次；startupDone 兜住后续依赖变化。
  }, [info, settings, open, applyActiveState, reloadSettings, restore, switchTo, resetOverlays, setToast, setError, t]);
}
