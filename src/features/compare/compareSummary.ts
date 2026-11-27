import type { ChangedFileDto, CompareMode } from "../../shared/types";

export type CompareRelationKind =
  | "same_commit"
  | "worktree"
  | "no_common_ancestor"
  | "two_dot"
  | "fast_forward"
  | "behind"
  | "diverged";

export interface CompareRelation {
  kind: CompareRelationKind;
  baseOnly: number;
  compareOnly: number;
  basePct: number;
  comparePct: number;
  showRatioBar: boolean;
}

export interface CompareFileStats {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  bothCount: number;
}

/** 判定两端对比的拓扑关系并计算领先/落后比例条百分比。 */
export function classifyCompareRelation(params: {
  sameCommit: boolean;
  worktree: boolean;
  twoDot: boolean;
  mode: CompareMode | null;
  baseOnly: number;
  compareOnly: number;
}): CompareRelation {
  const { sameCommit, worktree, twoDot, mode, baseOnly, compareOnly } = params;
  let kind: CompareRelationKind;
  if (worktree || mode === "worktree") {
    kind = "worktree";
  } else if (mode === "two_dot_fallback") {
    kind = "no_common_ancestor";
  } else if (sameCommit) {
    kind = "same_commit";
  } else if (twoDot || mode === "two_dot") {
    kind = "two_dot";
  } else if (baseOnly === 0 && compareOnly > 0) {
    kind = "fast_forward";
  } else if (baseOnly > 0 && compareOnly === 0) {
    kind = "behind";
  } else if (baseOnly > 0 && compareOnly > 0) {
    kind = "diverged";
  } else {
    kind = "same_commit";
  }

  const showRatioBar =
    kind === "fast_forward" || kind === "behind" || kind === "diverged";
  const total = baseOnly + compareOnly;
  const basePct = total > 0 ? Math.round((baseOnly / total) * 100) : 50;
  return {
    kind,
    baseOnly,
    compareOnly,
    basePct,
    comparePct: 100 - basePct,
    showRatioBar,
  };
}

/** 汇总对比文件列表的 A/M/D/R 计数与双侧均改数量。 */
export function summarizeCompareFiles(files: readonly ChangedFileDto[]): CompareFileStats {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;
  let bothCount = 0;
  for (const file of files) {
    switch (file.status) {
      case "added":
        added += 1;
        break;
      case "deleted":
        deleted += 1;
        break;
      case "renamed":
      case "copied":
        renamed += 1;
        break;
      case "modified":
      case "type_changed":
        modified += 1;
        break;
    }
    if (file.change_origin === "both") {
      bothCount += 1;
    }
  }
  return {
    total: files.length,
    added,
    modified,
    deleted,
    renamed,
    bothCount,
  };
}
