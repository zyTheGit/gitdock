// Stash 预览 DTO 镜像（ADR-0009 / ADR-0030）；从 types.ts re-export，调用方仍从那里导入。
import type { ChangedFileDto, WarningDto } from "./types";

/** 单个本地 stash；index 0 为最新。 */
export interface StashEntryDto {
  index: number;
  selector: string;
  oid: string;
  /** Git reflog 原始消息，不翻译。 */
  message: string;
  /** reflog 时间（Unix 秒）。 */
  created_at: number;
}

/** 单条 stash 的改动清单：文件条目复用 ChangedFileDto，不引入 stash 专用类型。 */
export interface StashDetailDto {
  generation: number;
  oid: string;
  files: ChangedFileDto[];
  /** 文件数超过服务端上限，清单已截断。 */
  truncated: boolean;
  /** 该条 stash 由 `git stash -u` 创建，清单包含未跟踪文件。 */
  includes_untracked: boolean;
  warnings: WarningDto[];
}
