import type { MessageShape } from "../messages";

/** repository 域：仓库切换器与仓库会话提示。 */
const repository = {} as const;

export default repository;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type RepositoryMessages = MessageShape<typeof repository>;