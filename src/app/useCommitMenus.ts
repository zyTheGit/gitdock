import { rowMenuItems, type CommitMenuActions } from "../features/graph/menus";
import { branchMenuItems, branchSlot } from "../features/repository/branchMenus";
import { commitSlot, useCompareSlots } from "../features/compare/useCompare";
import { copyText } from "../shared/clipboard";
import type { CommitSummaryDto, RefDto, RepoStateDto } from "../shared/types";

/** 双槽状态由 useCompareSlots 提供，这里只消费其槽位写入成员。 */
type CompareSlots = ReturnType<typeof useCompareSlots>;

/** 提交行右键菜单的落点坐标、目标提交与当前批量选择。 */
export interface RowMenuState {
  x: number;
  y: number;
  commit: CommitSummaryDto;
  /** Shift+点击形成的批量选择；右键落在集合内时菜单显示批量项。 */
  selection?: CommitSummaryDto[];
}

/** 分支右键菜单的落点坐标与目标分支。 */
export interface BranchMenuState {
  x: number;
  y: number;
  branch: RefDto;
}

interface UseCommitMenusParams {
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  repo: RepoStateDto | null;
  slots: CompareSlots;
  writeDisabled: boolean;
  descriptionDisabled: boolean;
  onCopyMessage: (oid: string) => void;
  onNewBranch: (commit: CommitSummaryDto) => void;
  onNewTag: (commit: CommitSummaryDto) => void;
  onRenameBranch: (shortName: string) => void;
  onDeleteBranch: (shortName: string) => void;
  onMergeBranch: (shortName: string) => void;
  onRebaseBranch: (shortName: string) => void;
  onCherryPick: (commit: CommitSummaryDto) => void;
  onRevert: (commit: CommitSummaryDto) => void;
  onBatchCherryPick: (commits: CommitSummaryDto[]) => void;
  onBatchRevert: (commits: CommitSummaryDto[]) => void;
  onEditDescription: (shortName: string) => void;
  onSelectCommit: (oid: string) => void;
}

/**
 * 组装右键菜单条目：提交行菜单与分支菜单共享同一套写/对比动作。
 * 菜单落点状态（rowMenu/branchMenu）由调用方持有，便于切仓库时统一复位。
 */
export function useCommitMenus({
  rowMenu,
  branchMenu,
  repo,
  slots,
  writeDisabled,
  descriptionDisabled,
  onCopyMessage,
  onNewBranch,
  onNewTag,
  onRenameBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onCherryPick,
  onRevert,
  onBatchCherryPick,
  onBatchRevert,
  onEditDescription,
  onSelectCommit,
}: UseCommitMenusParams) {
  const commitActions: CommitMenuActions = {
    writeDisabled,
    onCopyHash: (oid) => void copyText(oid),
    onCopyMessage,
    onCherryPick,
    onRevert,
  };

  const activeRowMenuItems = rowMenu
    ? rowMenuItems(
        rowMenu.commit,
        {
          ...commitActions,
          onSetBase: (commit) => slots.setSide("base", commitSlot(commit)),
          onSetCompare: (commit) => slots.setSide("compare", commitSlot(commit)),
          onOpenDetail: (commit) => onSelectCommit(commit.oid),
          onNewBranch,
          onNewTag,
          onBatchCherryPick,
          onBatchRevert,
        },
        rowMenu.selection ?? [],
      )
    : [];

  // 以 HEAD 作 Base、所选分支作 Compare；Base 已占用时不覆盖用户的选择。
  const compareWithHead = (branch: RefDto) => {
    if (repo?.head.oid && !slots.base) {
      slots.setSide("base", {
        oid: repo.head.oid,
        label: repo.head.kind === "branch" ? repo.head.branch ?? "HEAD" : "detached HEAD",
      });
    }
    slots.setSide("compare", branchSlot(branch));
  };

  const activeBranchMenuItems = branchMenu
    ? branchMenuItems(branchMenu.branch, {
        descriptionDisabled,
        writeDisabled,
        hasHead: Boolean(repo?.head.oid),
        onEditDescription,
        onCompareWithHead: compareWithHead,
        onSetBase: (branch) => slots.setSide("base", branchSlot(branch)),
        onSetCompare: (branch) => slots.setSide("compare", branchSlot(branch)),
        onRenameBranch,
        onDeleteBranch,
        onMergeBranch,
        onRebaseBranch,
      })
    : [];

  return { commitActions, activeRowMenuItems, activeBranchMenuItems };
}