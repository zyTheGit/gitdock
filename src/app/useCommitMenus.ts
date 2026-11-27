import { rowMenuItems, type CommitMenuActions } from "../features/graph/menus";
import { branchMenuItems, tagMenuItems } from "../features/repository/branchMenus";
import { remoteNamesFromRefs } from "../features/repository/remotes";
import type { CommitSummaryDto, RefDto, RepoStateDto } from "../shared/types";
import type { ActionExecutor } from "./useActionCatalog";

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
  writeDisabled: boolean;
  descriptionDisabled: boolean;
  execute: ActionExecutor;
  onRenameBranch: (shortName: string) => void;
  onDeleteBranch: (shortName: string) => void;
  onDeleteBranchRemote: (name: string) => void;
  onCheckoutRemote: (branch: RefDto) => void;
  onDeleteTag: (name: string) => void;
  onDeleteTagRemote: (name: string) => void;
  onPushTag: (tag: RefDto) => void;
  onMergeBranch: (shortName: string) => void;
  onRebaseBranch: (shortName: string) => void;
  onBatchCherryPick: (commits: CommitSummaryDto[]) => void;
  onBatchRevert: (commits: CommitSummaryDto[]) => void;
  onEditDescription: (shortName: string) => void;
  onEditTagDescription: (tag: RefDto) => void;
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
  writeDisabled,
  descriptionDisabled,
  execute,
  onRenameBranch,
  onDeleteBranch,
  onDeleteBranchRemote,
  onCheckoutRemote,
  onDeleteTag,
  onDeleteTagRemote,
  onPushTag,
  onMergeBranch,
  onRebaseBranch,
  onBatchCherryPick,
  onBatchRevert,
  onEditDescription,
  onEditTagDescription,
}: UseCommitMenusParams) {
  const commitActions: CommitMenuActions = {
    writeDisabled,
    onCopyHash: (oid) => execute("graph:copyCommitHash", { kind: "commit", oid }),
    onCopyMessage: (oid) => execute("graph:copyCommitMessage", { kind: "commit", oid }),
    onCherryPick: (commit) =>
      execute("graph:cherryPickCommit", { kind: "commit", oid: commit.oid, commit }),
    onRevert: (commit) =>
      execute("graph:revertCommit", { kind: "commit", oid: commit.oid, commit }),
  };
  // 远程名取自远程跟踪引用（前端没有独立的 remote 列表契约，ADR-0028）。
  const remoteNames = remoteNamesFromRefs(repo?.refs ?? []);

  const activeRowMenuItems = rowMenu
    ? rowMenuItems(
        rowMenu.commit,
        {
          ...commitActions,
          onSetBase: (commit) =>
            execute("compare:setBase", { kind: "commit", oid: commit.oid, commit }),
          onSetCompare: (commit) =>
            execute("compare:setCompare", { kind: "commit", oid: commit.oid, commit }),
          onOpenDetail: (commit) =>
            execute("graph:openCommitDetail", { kind: "commit", oid: commit.oid, commit }),
          onNewBranch: (commit) =>
            execute("graph:createBranchHere", { kind: "commit", oid: commit.oid, commit }),
          onNewTag: (commit) =>
            execute("graph:createTagHere", { kind: "commit", oid: commit.oid, commit }),
          onResetHere: (commit) =>
            execute("graph:resetBranchHere", { kind: "commit", oid: commit.oid, commit }),
          onBatchCherryPick,
          onBatchRevert,
        },
        rowMenu.selection ?? [],
      )
    : [];

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
        onSwitchBranch: (branch) =>
          execute("refs:switchBranch", { kind: "ref", ref: branch }),
        onFilterGraph: (branch) =>
          execute("refs:filterGraph", { kind: "ref", ref: branch }),
        onCompareWithHead: (branch) =>
          execute("refs:compareWithHead", { kind: "ref", ref: branch }),
        onSetBase: (branch) =>
          execute("compare:setBase", { kind: "ref", ref: branch }),
        onSetCompare: (branch) =>
          execute("compare:setCompare", { kind: "ref", ref: branch }),
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
        onSetBase: (tag) => execute("compare:setBase", { kind: "ref", ref: tag }),
        onSetCompare: (tag) => execute("compare:setCompare", { kind: "ref", ref: tag }),
        onRevealCommit: (tag) =>
          execute("refs:locateCommit", { kind: "ref", ref: tag }),
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