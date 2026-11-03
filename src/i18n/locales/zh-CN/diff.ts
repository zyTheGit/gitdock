import type { MessageShape } from "../messages";

/** diff 域：文件 diff 视图与文件状态标签。新增 key 必须同步 en/diff.ts。 */
const diff = {
  // 文件状态标签（fileStatus 的 statusLabelKey 映射）
  statusAdded: "新增",
  statusDeleted: "删除",
  statusModified: "修改",
  statusTypeChanged: "类型变更",
  statusRenamed: "重命名",
  statusCopied: "复制",

  // 头部与工具栏控件
  loading: "读取中…",
  expandedViewLabel: "文件 diff 放大视图",
  collapseFileList: "收起变更文件列表",
  expandFileList: "展开变更文件列表",
  viewMode: "diff 视图模式",
  splitView: "并排显示",
  unifiedView: "统一显示",
  wrapTitle: "长行自动换行，避免横向滚动",
  wrap: "长行自动换行",
  restoreHint: "还原（Esc）",
  expandHint: "放大到整个窗口查看 diff",
  restoreView: "还原 diff 视图",
  expandView: "放大 diff 视图",

  // 放大视图侧栏
  changedFileList: "变更文件列表",
  changedFiles: "变更文件",
  fileContextMenuHint: "{{path}}（右键可用外部工具对比）",

  // 文件导航
  previousFile: "上一个文件",
  nextFile: "下一个文件",
  switchFile: "切换对比文件",
  filePickerLabel: "{{index}}/{{total}} · {{path}}",

  // 内容横幅
  binaryFile: "二进制文件，不显示文本 diff。",
  tooLarge: "文件过大，仅显示变更统计，不加载内容。",
  truncated: "diff 过长，已截断为前若干行。",
  encodingFallback: "文件包含非 UTF-8 字节，已按替换字符显示。",
  gitlinkChanged: "子模块指针变更：",
  gitlinkEmpty: "（空）",
  gitlinkNoExpand: "（不展开子模块内部 diff）",

  // 空态与降级说明
  noHighlight: "未启用语法高亮（语言不在支持列表或变更行数过多），已保留行内差异标记。",
  noTextDiff: "该文件没有可显示的文本差异。",
} as const;

export default diff;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type DiffMessages = MessageShape<typeof diff>;