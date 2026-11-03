import type { MessageShape } from "../messages";

/** staging 域：暂存区视图与文件列表。 */
const staging = {} as const;

export default staging;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type StagingMessages = MessageShape<typeof staging>;