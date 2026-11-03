import type { StagingMessages } from "../zh-CN/staging";

/** staging 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const staging = {} satisfies StagingMessages;

export default staging;