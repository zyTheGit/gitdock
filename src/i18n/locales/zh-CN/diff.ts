import type { MessageShape } from "../messages";

/** diff 域：文件 diff 视图与文件状态标签。 */
const diff = {} as const;

export default diff;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type DiffMessages = MessageShape<typeof diff>;