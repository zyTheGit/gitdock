import type { DiffMessages } from "../zh-CN/diff";

/** diff 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const diff = {} satisfies DiffMessages;

export default diff;