import type { DetailMessages } from "../zh-CN/detail";

/** detail 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const detail = {} satisfies DetailMessages;

export default detail;