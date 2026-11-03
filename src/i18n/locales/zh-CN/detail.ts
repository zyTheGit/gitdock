import type { MessageShape } from "../messages";

/** detail 域：提交详情面板。 */
const detail = {
  commitDetails: "提交详情",
  closeAria: "关闭详情",
  loading: "正在读取提交详情…",
  commitMessage: "提交说明",
  parents: "父提交",
  rootCommit: "（根提交）",
  containingBranches: "所在分支",
  noContainingBranches: "（无本地分支包含此提交）",
  branchJumpTitle: "切换到 {{branch}} 的图谱视图",
  changedFiles: "变更文件（{{n}}）",
  noFileChanges: "此提交没有文件变更。",
  fileRowTitle: "{{path}}（右键可用外部工具对比）",
  fileDiffLoading: "正在读取文件 diff…",
  selectFileHint: "选择左侧文件查看 diff。",
  noExternalTool: "尚未配置外部工具",
  openWithTool: "用 {{name}} 打开",
} as const;

export default detail;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type DetailMessages = MessageShape<typeof detail>;