import type { MessageShape } from "../messages";

/** write 域：写操作流程（确认框/结果消息/分支描述弹窗）。 */
const write = {} as const;

export default write;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type WriteMessages = MessageShape<typeof write>;