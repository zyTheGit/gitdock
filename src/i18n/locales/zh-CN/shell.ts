import type { MessageShape } from "../messages";

/** shell 域：公共壳（App 壳/顶栏/状态栏/横幅/侧栏/工作区徽标）。 */
const shell = {} as const;

export default shell;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type ShellMessages = MessageShape<typeof shell>;