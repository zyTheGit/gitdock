// 多仓库标签页 DTO（ADR-0032 / ADR-0036）。实体独立成文件，types.ts 统一 re-export。

import type { RepoStateDto } from "./types";

/** 进程内单调递增的仓库 id（从 1 开始；标签关闭后不复用）。 */
export type RepoId = number;

/** 标签栏一项；name 取目录名。 */
export interface RepoTabDto {
  repo_id: RepoId;
  path: string;
  name: string;
  is_active: boolean;
}

/** `list_repositories` 返回：顺序即打开顺序，active 为当前活动标签。 */
export interface RepoListDto {
  repos: RepoTabDto[];
  active: RepoId | null;
}

/** `restore_repositories` 返回：全部标签一次恢复，只有活动仓库带完整状态。 */
export interface RepoRestoreDto {
  list: RepoListDto;
  active_state: RepoStateDto | null;
  /** 无法恢复的路径（目录不存在或不是 Git 仓库），按打开顺序。 */
  failures: string[];
}

/** `repository-changed` 事件载荷：前端按 repo_id 路由，非活动仓库只标脏。 */
export interface RepositoryChangedDto {
  repo_id: RepoId;
  path: string;
  generation: number;
}
