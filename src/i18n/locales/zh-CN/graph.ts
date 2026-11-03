import type { MessageShape } from "../messages";

/** graph 域：提交图谱（泳道列表/悬浮卡/右键菜单/范围切换）。 */
const graph = {} as const;

export default graph;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type GraphMessages = MessageShape<typeof graph>;