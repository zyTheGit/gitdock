import type { TerminalMessages } from "../zh-CN/terminal";

/** terminal 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const terminal = {} satisfies TerminalMessages;

export default terminal;