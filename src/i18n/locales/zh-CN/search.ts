import type { MessageShape } from "../messages";

/** search 域：提交搜索视图。新增 key 必须同步 en/search.ts。 */
const search = {
  // 对话框
  dialogTitle: "搜索提交",
  closeSearch: "关闭搜索",

  // 输入与工具栏
  placeholder: "搜索信息 / 至少 7 位 hash / 作者 / 路径",
  searchButton: "搜索",
  searching: "搜索中…",
  cancel: "取消",

  // 范围与状态
  scopeHint: "搜索范围：{{repo}} · 当前视图 ref 范围 · 文件路径按“改动中出现”匹配",
  scopeWithResults:
    "搜索范围：{{repo}} · 当前视图 ref 范围 · 文件路径按“改动中出现”匹配 · 已返回 {{n}} 条",
  canceled: "搜索已取消；已有结果保留，不再继续追加。",
  noResults: "没有匹配的提交。hash 前缀至少 7 位。",

  // 快捷键提示（kbd 按键符号为原文，句子分段拼接）
  hintEnter: "输入关键词后回车搜索；",
  hintPick: " 选择候选，",
  hintClose: " 关闭。",
  hintSource: "候选来自当前已加载提交的作者与说明。",

  // 结果行
  locateInGraph: "{{oid}} · 在主图谱中定位",
  noSummary: "（无提交说明）",
  fieldMessage: "信息",
  fieldHash: "哈希",
  fieldAuthor: "作者",
  fieldPath: "路径",

  // 加载更多
  loadingMore: "加载中…",
  loadMore: "加载更多结果",

  // 加载错误（useSearch）
  repoChanged: "仓库状态已变化，请重新搜索",
} as const;

export default search;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type SearchMessages = MessageShape<typeof search>;