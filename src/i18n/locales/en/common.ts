import type { CommonMessages } from "../zh-CN/common";

/** common 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构（编译期校验缺失翻译）。 */
const common = {
  language: "Language",
  languageOptionSystem: "Follow system",
  languageOptionZhCn: "简体中文",
  languageOptionEn: "English",
  languageHint: "Applies immediately and persists across restarts.",
} satisfies CommonMessages;

export default common;