import type { MessageShape } from "../messages";

/** compare 域：双槽对比、分支对比与结果视图。新增 key 必须同步 en/compare.ts。 */
const compare = {
  // 双槽选择栏
  slotUnselected: "未选择",
  slotBase: "Base",
  slotCompare: "Compare",
  clearSlot: "清空 {{title}}",
  barLabel: "对比选择",
  slotMenuLabel: "{{title}} 更多操作",
  headTitle: "HEAD {{oid}}",
  swapSides: "交换 Base 与 Compare",
  slotWorktree: "当前工作区",
  worktreeShort: "工作区",
  useWorktree: "用当前工作区填入这一侧",
  worktreeSelected: "这一侧已是工作区",
  worktreeBlocked: "另一侧已是工作区，两侧不能同时选择",
  hintActive: "Compare 相对 Base 共同祖先的改动 · {{modifier}}+点击可替换",
  hintIdle: "{{modifier}}+点击提交填入 Compare，或用「对比分支…」按分支选择",
  hintCompactIdle: "{{modifier}}+点击选择",
  replaceWhichSide: "替换哪一侧？",
  newSelection: "新选择 {{label}}（{{oid}}）",
  replaceBase: "替换 Base",
  replaceCompare: "替换 Compare",
  cancel: "取消",

  // 常用对比方案
  presetSave: "收藏当前对比",
  presetList: "对比方案",
  presetSaveTitle: "收藏当前对比",
  presetListTitle: "常用对比方案",
  presetSnapshotHint: "保存当前提交快照，方案不会跟随分支移动。",
  presetCurrent: "当前对比",
  presetNameLabel: "方案名称",
  presetNamePlaceholder: "例如：发布候选对比",
  presetNameRequired: "方案名称不能为空",
  presetSaveAction: "保存方案",
  presetSaving: "正在保存…",
  presetEmpty: "还没有收藏对比方案。",
  presetEmptyHint: "选择两个提交后，点击收藏入口保存当前对比。",
  presetCreated: "创建于 {{time}}",
  presetApply: "应用",
  presetApplyNamed: "应用方案 {{name}}",
  presetDelete: "删除",
  presetDeleteNamed: "删除方案 {{name}}",
  presetDeleting: "正在删除…",
  presetStorageError: "无法更新对比方案，请检查浏览器本地存储是否可用。",
  presetNeedBoth: "请先选择 Base 和 Compare",
  presetWorktreeUnsupported: "工作区不能收藏为对比方案，请选择两个提交",
  presetInvalidEndpoint: "仅支持完整的提交 OID",

  // 分支对比对话框
  dialogTitle: "对比引用",
  closeDialog: "关闭对比引用",
  fieldBase: "Base（基准）",
  fieldCompare: "Compare（对比）",
  groupLocal: "本地分支",
  groupRemote: "远程分支",
  groupTags: "标签",
  modeHint: "默认按三点 diff 比较（Base 与 Compare 的共同祖先 → Compare），可在对比视图切换为两点快照。",
  sameBranchError: "Base 与 Compare 不能是同一引用。",
  sameCommitHint: "两个引用当前指向同一提交，对比结果将为空。",
  currentBranchOption: "{{branch}}（当前）",
  startCompare: "开始对比",

  // 结果视图
  noExternalTool: "尚未配置外部工具",
  openWithTool: "用 {{name}} 打开",
  openCurrentFile: "用 {{name}} 打开当前文件",
  externalToolFallback: "外部工具",
  computing: "正在计算三点对比…",
  noCommonAncestor: "两个引用没有共同祖先（shallow / orphan 仓库），已降级为两端快照对比。",
  sameCommitTip: "Base 与 Compare 指向同一提交（{{oid}}），没有可显示的差异。",
  emptyThreeDot: "三点 diff 为空：Compare 相对共同祖先没有引入文件改动（例如 Compare 是 Base 的祖先，或两端工作树内容一致）。",
  switchToTwoDot: "切换到两点快照查看两端完整差异",
  pathFilter: "路径过滤",
  pathFilterPlaceholder: "例如 src/ 或 README.md",
  clearFilter: "清除",
  changedFilesCount: "变更文件 {{n}} 个",
  selectTool: "选择外部对比工具",
  statusFilter: "按文件状态筛选",
  filterAll: "全部",
  filterEmpty: "当前状态筛选没有匹配的文件。",
  externalWorktreeUnavailable: "工作区一侧不是提交，不支持外部工具对比",

  // 结果头部
  titleThreeDot: "Compare 相对 Base 共同祖先的改动",
  titleTwoDot: "Compare 与 Base 的完整快照差异",
  modeGroup: "对比模式",
  modeThreeDot: "三点 diff",
  modeTwoDot: "两点快照",
  modeTwoDotFallback: "两点快照降级",
  modeWorktree: "工作区快照",
  modeThreeDotHint: "git diff base...compare：只显示 Compare 相对共同祖先的改动",
  modeTwoDotHint: "git diff base compare：显示两个提交的完整快照差异",
  modeWorktreeHint: "工作区没有提交历史，没有共同祖先可算，只能按两端快照对比",
  sideCounts: "左侧 Base 独有 {{baseOnly}} · 右侧 Compare 独有 {{compareOnly}}",
  viewGraph: "查看图谱",
  directoryDiff: "目录对比",
  directoryDiffHint: "把两侧提交的完整目录树导出到临时文件夹，再交给外部工具对比",
  directoryDiffWorktreeHint: "工作区一侧不是提交，无法导出目录树；请选择两个提交后再用目录对比",

  // 提交列表
  resizeHandle: "调整提交列表高度",
  resizeHint: "拖动调整提交列表高度，双击恢复默认",
  commitsIntroduced: "Compare 引入的提交（{{n}}）",
  commitsIntroducedTruncated: "Compare 引入的提交（{{n}}+）",
  noNewCommits: "Compare 没有相对共同祖先的新提交。",

  // 文件列表与 diff 面板
  changedFiles: "变更文件（{{n}}）",
  noFileChanges: "此范围没有文件变更。",
  loadingDiff: "正在读取文件 diff…",
  selectFileHint: "选择左侧文件查看 diff。",

  // 加载错误
  repoChanged: "仓库状态已变化，请刷新后重试对比",
  refUnresolved: "引用已无法解析，请重新选择 Base / Compare",
} as const;

export default compare;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type CompareMessages = MessageShape<typeof compare>;