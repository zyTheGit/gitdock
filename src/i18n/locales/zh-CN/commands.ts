import type { MessageShape } from "../messages";

const commands = {
  title: "命令面板",
  placeholder: "搜索操作…",
  empty: "没有匹配的操作",
  hint: "↑↓ 选择 · Enter 执行 · Esc 关闭",
  listLabel: "可用操作",
  contextGlobal: "全局",
  contextGraph: "图谱",
  contextCompare: "对比",
  contextStaging: "暂存区",
  contextRefs: "引用",
  disabledNoRepo: "请先打开仓库",
  disabledBusy: "操作进行中，暂不可用",
  disabledBare: "bare 仓库没有工作区",
  disabledSelection: "请先选择提交或文件",
  disabledCompare: "请先选择 Base 和 Compare",
  disabledCompareRefs: "至少需要两个可对比引用",
  disabledWrite: "请先处理当前中断或写操作",
  disabledNoConflicts: "当前没有冲突",
  disabledNoHead: "仓库还没有提交",
  disabledSelectRef: "请先选择引用",
  disabledSelectRepository: "请先选择仓库标签",
  disabledInvalidTarget: "操作目标无效",
  disabledStagingSide: "文件不在可执行此操作的一侧",
  disabledRefWithoutCommit: "该引用没有可定位的提交",
  disabledLocalBranchOnly: "只能切换本地分支",
  disabledAlreadyHead: "已经是当前分支",
  disabledRepositoryActive: "已经是当前仓库",
} as const;

export default commands;
export type CommandMessages = MessageShape<typeof commands>;
