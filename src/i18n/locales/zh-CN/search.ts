import type { MessageShape } from "../messages";

/** search 域：提交搜索视图。 */
const search = {} as const;

export default search;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type SearchMessages = MessageShape<typeof search>;