import type { MessageShape } from "../messages";

/** history 域：单文件提交历史与行级追溯（ADR-0031）。 */
const history = {
  title: "文件历史",
  closeAria: "关闭文件历史",
  tabHistory: "提交历史",
  tabBlame: "Blame",
  viewFileHistory: "查看文件历史",
  viewFileBlame: "查看 Blame",
  noHeadCommit: "尚无提交，无法查看历史",
  loadingHistory: "正在读取文件历史…",
  loadingBlame: "正在计算 Blame…",
  loadingDiff: "正在读取该次改动…",
  emptyHistory: "没有提交修改过这个路径。",
  loadMore: "加载更多",
  loadingMore: "正在加载更多…",
  timelineLabel: "文件提交时间线",
  selectEntryHint: "选择左侧提交，查看该次对该文件的改动。",
  locateCommit: "在图谱中定位此提交",
  compareAdjacent: "对比相邻版本",
  compareSingle: "只看单次改动",
  openExternalDiff: "外部工具对比",
  adjacentPair: "相邻版本 {{from}} → {{to}}",
  blameBinary: "二进制文件不支持逐行追溯。",
  blameTooLarge: "文件过大，已跳过逐行追溯。",
  blameEmpty: "没有可追溯的行。",
  blameEncoding: "文件不是 UTF-8，内容按有损解码展示。",
  limitations: "首版只追踪当前路径，不跟随重命名；跨合并的归属按第一父链计算。",
  stagingNote: "暂存区入口显示 HEAD 提交中的内容，不含尚未提交的改动。",
  blameJumpTitle: "在图谱中定位提交 {{oid}}",
} as const;

export default history;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type HistoryMessages = MessageShape<typeof history>;
