// 单文件历史与行级追溯（Blame）的 DTO 镜像，见 ADR-0031。
// 与既有 DTO 一样只消费 Rust 结构；从 types.ts re-export，调用方仍从那里导入。
import type { CommitSummaryDto, FileStatus } from "./types";

/** 单文件历史条目：`status` 为该提交相对第一父对路径的改动类型。 */
export interface FileHistoryEntryDto {
  commit: CommitSummaryDto;
  status: FileStatus;
  /** 首版不追踪重命名，后端不返回；保留字段供后续 follow 启发式使用。 */
  old_path?: string;
}

export interface FileHistoryPageDto {
  generation: number;
  path: string;
  entries: FileHistoryEntryDto[];
  next_cursor?: string;
  has_more: boolean;
}

export interface BlameLineDto {
  /** 1 起的行号。 */
  line_no: number;
  oid: string;
  short_oid: string;
  author_name: string;
  /** Unix 秒。 */
  authored_at: number;
  /** 归属提交的首行摘要。 */
  summary: string;
  /** 行内容，不含行尾换行符。 */
  content: string;
}

export interface FileBlameDto {
  generation: number;
  oid: string;
  path: string;
  lines: BlameLineDto[];
  binary: boolean;
  too_large: boolean;
  /** 内容不是合法 UTF-8，已按有损方式解码。 */
  encoding_fallback: boolean;
  language?: string;
}
