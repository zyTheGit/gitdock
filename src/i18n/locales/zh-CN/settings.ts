import type { MessageShape } from "../messages";

/** settings 域：设置弹窗各分区、反馈框与设置草稿。 */
const settings = {} as const;

export default settings;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type SettingsMessages = MessageShape<typeof settings>;