import type { MessageShape } from "../messages";

/** terminal 域：终端面板与 LazyGit/Shell 启动指引。 */
const terminal = {} as const;

export default terminal;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type TerminalMessages = MessageShape<typeof terminal>;