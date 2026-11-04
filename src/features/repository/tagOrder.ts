import type { RefDto } from "../../shared/types";

/**
 * 标签按创建时间倒序：annotated tag 用 tagger 时间，轻量 tag 由后端回退到
 * 指向提交的提交时间；没有时间信息的标签排在最后，保持原有相对顺序。
 */
export function latestTagsFirst(tags: RefDto[]): RefDto[] {
  return [...tags].sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0));
}