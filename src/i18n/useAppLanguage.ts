import { useCallback, useEffect } from "react";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { SettingsDto } from "../shared/types";
import { i18next, resolveLanguage, storePreference, toLanguagePreference } from ".";
import type { LanguagePreference } from ".";

/**
 * 语言与设置同步：
 * - settings.json 的 language 字段是权威值；启动后与 i18next 当前语言不一致时以它为准。
 * - 切换即时生效：写 settings.json（独立命令，不走设置草稿）+ 本地镜像 + changeLanguage。
 */
export function useAppLanguage(
  settings: SettingsDto | null,
  onSaved: (settings: SettingsDto) => void,
  onError: (message: string) => void,
) {
  useEffect(() => {
    if (!settings) return;
    const preference = toLanguagePreference(settings.language);
    const resolved = resolveLanguage(preference);
    if (i18next.language !== resolved) void i18next.changeLanguage(resolved);
    storePreference(preference);
  }, [settings]);

  const changeLanguage = useCallback(
    async (preference: LanguagePreference) => {
      try {
        const next = await ipc.setLanguage(preference === "system" ? null : preference);
        onSaved(next);
        storePreference(preference);
        await i18next.changeLanguage(resolveLanguage(preference));
      } catch (err) {
        onError(errorText(err));
      }
    },
    [onSaved, onError],
  );

  return { changeLanguage };
}