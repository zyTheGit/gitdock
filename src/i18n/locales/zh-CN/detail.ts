import type { MessageShape } from "../messages";

/** detail 域：提交详情面板。 */
const detail = {} as const;

export default detail;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type DetailMessages = MessageShape<typeof detail>;