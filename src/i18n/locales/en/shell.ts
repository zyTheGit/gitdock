import type { ShellMessages } from "../zh-CN/shell";

/** shell 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const shell = {} satisfies ShellMessages;

export default shell;