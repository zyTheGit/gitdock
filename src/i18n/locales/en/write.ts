import type { WriteMessages } from "../zh-CN/write";

/** write 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const write = {} satisfies WriteMessages;

export default write;