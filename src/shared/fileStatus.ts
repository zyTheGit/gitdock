// 变更状态的两种展示形式：紧凑字母（列表）与中文标签（diff 头部）。
import type { FileStatus } from "./types";

export const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  type_changed: "T",
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  added: "新增",
  deleted: "删除",
  modified: "修改",
  type_changed: "类型变更",
};
