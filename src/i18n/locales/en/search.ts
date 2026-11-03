import type { SearchMessages } from "../zh-CN/search";

/** search 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const search = {} satisfies SearchMessages;

export default search;