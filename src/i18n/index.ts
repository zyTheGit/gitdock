import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import enCommon from "./locales/en/common";
import zhCnCommon from "./locales/zh-CN/common";

export type AppLanguage = "zh-CN" | "en";
export type LanguagePreference = AppLanguage | "system";

const LANGUAGE_STORAGE_KEY = "gitdock.language";

/** 把偏好（system 或具体语言）解析为实际语言：系统中文 → 简体中文，其余 → 英文。 */
export function resolveLanguage(preference: string | null | undefined): AppLanguage {
  if (preference === "zh-CN" || preference === "en") return preference;
  const system = navigator.language?.toLowerCase() ?? "en";
  return system.startsWith("zh") ? "zh-CN" : "en";
}

/** 把后端返回的 language 字段收窄为受支持的偏好；非法值按跟随系统处理。 */
export function toLanguagePreference(value: string | null | undefined): LanguagePreference {
  return value === "zh-CN" || value === "en" ? value : "system";
}

/** 本地镜像仅为启动首帧不闪语言；权威值是 settings.json 的 language 字段。 */
function storedPreference(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePreference(preference: LanguagePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // localStorage 不可用时语言仍可切换，只是下次启动回到系统默认。
  }
}

/** 启动同步初始化：main.tsx 在首帧渲染前调用，避免界面语言闪变。 */
export function initI18n(): void {
  const language = resolveLanguage(storedPreference());
  void i18next.use(initReactI18next).init({
    resources: {
      "zh-CN": { common: zhCnCommon },
      en: { common: enCommon },
    },
    lng: language,
    fallbackLng: "zh-CN",
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

/** 当前展示语言（i18next 就绪前回落 zh-CN）。 */
export function currentLanguage(): AppLanguage {
  return i18next.language === "en" ? "en" : "zh-CN";
}

/** 日期/数字格式化用的 BCP 47 locale。 */
export function currentLocale(): string {
  return currentLanguage() === "zh-CN" ? "zh-CN" : "en-US";
}

/** 统一翻译入口：组件内使用。工具模块等非 React 上下文用 i18next.t。 */
export function useI18n() {
  const { t, i18n } = useTranslation();
  return { t, i18n, language: currentLanguage() };
}

export { i18next };