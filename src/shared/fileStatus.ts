// 变更状态的展示形式：紧凑字母（列表）与文案标签（diff 头部）。
// 已迁移 i18n 的消费处用 statusLabelKey(status) + t() 渲染；
// STATUS_LABEL 保留给尚未迁移的旧消费处，由主会话收尾统一迁移。
import type { FileStatus } from "./types";

export const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  type_changed: "T",
  renamed: "R",
  copied: "C",
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  added: "新增",
  deleted: "删除",
  modified: "修改",
  type_changed: "类型变更",
  renamed: "重命名",
  copied: "复制",
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
