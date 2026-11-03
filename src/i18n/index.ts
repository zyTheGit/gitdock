import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import enCommon from "./locales/en/common";
import enCompare from "./locales/en/compare";
import enDetail from "./locales/en/detail";
import enDiff from "./locales/en/diff";
import enGraph from "./locales/en/graph";
import enRepository from "./locales/en/repository";
import enSearch from "./locales/en/search";
import enSettings from "./locales/en/settings";
import enShell from "./locales/en/shell";
import enStaging from "./locales/en/staging";
import enTerminal from "./locales/en/terminal";
import enWrite from "./locales/en/write";
import zhCnCommon from "./locales/zh-CN/common";
import zhCnCompare from "./locales/zh-CN/compare";
import zhCnDetail from "./locales/zh-CN/detail";
import zhCnDiff from "./locales/zh-CN/diff";
import zhCnGraph from "./locales/zh-CN/graph";
import zhCnRepository from "./locales/zh-CN/repository";
import zhCnSearch from "./locales/zh-CN/search";
import zhCnSettings from "./locales/zh-CN/settings";
import zhCnShell from "./locales/zh-CN/shell";
import zhCnStaging from "./locales/zh-CN/staging";
import zhCnTerminal from "./locales/zh-CN/terminal";
import zhCnWrite from "./locales/zh-CN/write";

export type AppLanguage = "zh-CN" | "en";
export type LanguagePreference = AppLanguage | "system";

const LANGUAGE_STORAGE_KEY = "gitdock.language";

/** 消息域清单：新域须同时建 locales/<lang>/<domain>.ts 并在此与 types.ts 注册。 */
export const MESSAGE_NAMESPACES = [
  "common",
  "shell",
  "repository",
  "graph",
  "detail",
  "diff",
  "search",
  "compare",
  "staging",
  "terminal",
  "settings",
  "write",
] as const;

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
      "zh-CN": {
        common: zhCnCommon,
        shell: zhCnShell,
        repository: zhCnRepository,
        graph: zhCnGraph,
        detail: zhCnDetail,
        diff: zhCnDiff,
        search: zhCnSearch,
        compare: zhCnCompare,
        staging: zhCnStaging,
        terminal: zhCnTerminal,
        settings: zhCnSettings,
        write: zhCnWrite,
      },
      en: {
        common: enCommon,
        shell: enShell,
        repository: enRepository,
        graph: enGraph,
        detail: enDetail,
        diff: enDiff,
        search: enSearch,
        compare: enCompare,
        staging: enStaging,
        terminal: enTerminal,
        settings: enSettings,
        write: enWrite,
      },
    },
    lng: language,
    fallbackLng: "zh-CN",
    defaultNS: "common",
    ns: MESSAGE_NAMESPACES,
    // 「域.key」全限定形式：ns 用点分隔；资源 key 为扁平小驼峰（不含点），
    // keySeparator 保持点号只为兼容默认嵌套行为，实际不产生歧义。
    nsSeparator: ".",
    keySeparator: ".",
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

/** 统一翻译入口：组件内使用，key 用「域.key」全限定形式。非 React 上下文用 i18next.t。 */
export function useI18n() {
  const { t, i18n } = useTranslation(MESSAGE_NAMESPACES);
  return { t, i18n, language: currentLanguage() };
}

export { i18next };