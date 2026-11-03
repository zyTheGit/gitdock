import type { MessageShape } from "../messages";

/** compare 域：双槽对比、分支对比与结果视图。 */
const compare = {} as const;

export default compare;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type CompareMessages = MessageShape<typeof compare>;