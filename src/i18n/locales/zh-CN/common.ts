import type { MessageShape } from "../messages";

/** common 域：跨视图通用文案与语言设置。新增 key 必须同步 en/common.ts。 */
const common = {
  language: "语言",
  languageOptionSystem: "跟随系统",
  languageOptionZhCn: "简体中文",
  languageOptionEn: "English",
  languageHint: "切换立即生效，重启后保持。",
} as const;

export default common;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type CommonMessages = MessageShape<typeof common>;