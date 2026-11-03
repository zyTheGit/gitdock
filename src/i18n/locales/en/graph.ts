import type { GraphMessages } from "../zh-CN/graph";

/** graph 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const graph = {} satisfies GraphMessages;

export default graph;