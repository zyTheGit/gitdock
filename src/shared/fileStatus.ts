// 变更状态的展示形式：紧凑字母（列表）与文案标签（diff 头部）。
// 文案标签走 i18n：消费处用 t(statusLabelKey(status)) 渲染。
import type { FileStatus } from "./types";

export const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  type_changed: "T",
  renamed: "R",
  copied: "C",
};

/** 状态 → diff 域文案 key；渲染处用 t(statusLabelKey(status))。 */
const STATUS_LABEL_KEYS = {
  added: "diff.statusAdded",
  deleted: "diff.statusDeleted",
  modified: "diff.statusModified",
  type_changed: "diff.statusTypeChanged",
  renamed: "diff.statusRenamed",
  copied: "diff.statusCopied",
} as const satisfies Record<FileStatus, string>;

export function statusLabelKey(status: FileStatus): (typeof STATUS_LABEL_KEYS)[FileStatus] {
  return STATUS_LABEL_KEYS[status];
}
