import { rowMenuItems, type CommitMenuActions } from "../features/graph/menus";
import { branchMenuItems, branchSlot, tagMenuItems } from "../features/repository/branchMenus";
import { remoteNamesFromRefs } from "../features/repository/remotes";
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

/** 标签右键菜单的落点坐标与目标标签。 */
export interface TagMenuState {
  x: number;
  y: number;
  tag: RefDto;
}

interface UseCommitMenusParams {
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  tagMenu: TagMenuState | null;
  repo: RepoStateDto | null;
  slots: CompareSlots;
  writeDisabled: boolean;
  descriptionDisabled: boolean;
  onCopyMessage: (oid: string) => void;
  onNewBranch: (commit: CommitSummaryDto) => void;
  onNewTag: (commit: CommitSummaryDto) => void;
  onRenameBranch: (shortName: string) => void;
  onDeleteBranch: (shortName: string) => void;
  onDeleteBranchRemote: (name: string) => void;
  onCheckoutRemote: (branch: RefDto) => void;
  onDeleteTag: (name: string) => void;
  onDeleteTagRemote: (name: string) => void;
  onPushTag: (tag: RefDto) => void;
  onMergeBranch: (shortName: string) => void;
  onRebaseBranch: (shortName: string) => void;
  onCherryPick: (commit: CommitSummaryDto) => void;
  onRevert: (commit: CommitSummaryDto) => void;
  /** 重置当前分支到所选提交（ADR-0029）；由 useWriteFlow 的菜单动作集合提供。 */
  onResetHere: (commit: CommitSummaryDto) => void;
  onBatchCherryPick: (commits: CommitSummaryDto[]) => void;
  onBatchRevert: (commits: CommitSummaryDto[]) => void;
  onEditDescription: (shortName: string) => void;
  onEditTagDescription: (tag: RefDto) => void;
  onSelectCommit: (oid: string) => void;
  /** 分支双击/菜单「切换到此分支」：只允许本地分支，远程分支永不进入写流程。 */
  onSwitchBranch: (branch: RefDto) => void;
  /** 标签菜单「查看对应提交」：在图谱中定位并选中标签提交。 */
  onRevealRef: (ref: RefDto) => void;
  /** 远程分支菜单「按此引用过滤图谱」。 */
  onFilterRef: (ref: RefDto) => void;
}

/**
 * 组装右键菜单条目：提交行菜单与分支/标签菜单共享同一套写/对比动作。
 * 菜单落点状态（rowMenu/branchMenu/tagMenu）由调用方持有，便于切仓库时统一复位。
 */
export function useCommitMenus({
  rowMenu,
  branchMenu,
  tagMenu,
  repo,
  slots,
  writeDisabled,
  descriptionDisabled,
  onCopyMessage,
  onNewBranch,
  onNewTag,
  onRenameBranch,
  onDeleteBranch,
  onDeleteBranchRemote,
  onCheckoutRemote,
  onDeleteTag,
  onDeleteTagRemote,
  onPushTag,
  onMergeBranch,
  onRebaseBranch,
  onCherryPick,
  onRevert,
  onResetHere,
  onBatchCherryPick,
  onBatchRevert,
  onEditDescription,
  onEditTagDescription,
  onSelectCommit,
  onSwitchBranch,
  onRevealRef,
  onFilterRef,
}: UseCommitMenusParams) {
  const commitActions: CommitMenuActions = {
    writeDisabled,
    onCopyHash: (oid) => void copyText(oid),
    onCopyMessage,
    onCherryPick,
    onRevert,
  };
  // 远程名取自远程跟踪引用（前端没有独立的 remote 列表契约，ADR-0028）。
  const remoteNames = remoteNamesFromRefs(repo?.refs ?? []);

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
          onResetHere,
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
        // 远程跟踪引用的 short_name 保留 origin/ 前缀（refs.rs classify_ref）。
        hasRemoteTracking: repo?.refs.some(
          (ref) =>
            ref.kind === "remote_branch" &&
            ref.short_name === `origin/${branchMenu.branch.short_name}`,
        ) ?? false,
        onEditDescription,
        onSwitchBranch,
        onFilterGraph: onFilterRef,
        onCompareWithHead: compareWithHead,
        onSetBase: (branch) => slots.setSide("base", branchSlot(branch)),
        onSetCompare: (branch) => slots.setSide("compare", branchSlot(branch)),
        onRenameBranch,
        onDeleteBranch,
        onDeleteBranchRemote,
        onCheckoutRemote,
        onMergeBranch,
        onRebaseBranch,
      })
    : [];

  const activeTagMenuItems = tagMenu
    ? tagMenuItems(tagMenu.tag, {
        writeDisabled,
        descriptionDisabled,
        // 前端没有 remote 列表契约，用本地缓存的 origin/* 引用近似「存在 origin 远程」；
        // 无缓存时菜单项禁用，避免把配置缺失留给执行阶段。
        hasOriginRemote:
          repo?.refs.some(
            (ref) => ref.kind === "remote_branch" && ref.short_name.startsWith("origin/"),
          ) ?? false,
        hasRemote: remoteNames.length > 0,
        onEditDescription: onEditTagDescription,
        onSetBase: (tag) => slots.setSide("base", branchSlot(tag)),
        onSetCompare: (tag) => slots.setSide("compare", branchSlot(tag)),
        onRevealCommit: onRevealRef,
        onDeleteTag,
        onDeleteTagRemote,
        onPushTag,
      })
    : [];

  return {
    commitActions,
    activeRowMenuItems,
    activeBranchMenuItems,
    activeTagMenuItems,
  };
}