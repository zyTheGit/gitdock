import { i18next } from "../../i18n";
import type { MenuItem } from "../../shared/ContextMenu";
import type { RefDto } from "../../shared/types";

export interface BranchSlot {
  oid: string;
  label: string;
}

export function branchSlot(branch: RefDto): BranchSlot {
  return {
    oid: branch.commit_oid ?? branch.target_oid,
    label: branch.short_name,
  };
}

export interface BranchMenuActions {
  descriptionDisabled: boolean;
  writeDisabled: boolean;
  hasHead: boolean;
  /** 本地缓存里存在 origin/<branch> 远程跟踪引用；决定「删除本地和远程分支」是否可用。 */
  hasRemoteTracking: boolean;
  onSwitchBranch: (branch: RefDto) => void;
  onFilterGraph: (ref: RefDto) => void;
  onEditDescription: (shortName: string) => void;
  onCompareWithHead: (branch: RefDto) => void;
  onSetBase: (branch: RefDto) => void;
  onSetCompare: (branch: RefDto) => void;
  onRenameBranch: (shortName: string) => void;
  onDeleteBranch: (shortName: string) => void;
  onDeleteBranchRemote: (name: string) => void;
  onMergeBranch: (shortName: string) => void;
  onRebaseBranch: (shortName: string) => void;
  /** 远程分支菜单「检出为本地分支…」（ADR-0028）。 */
  onCheckoutRemote: (branch: RefDto) => void;
}

export function branchMenuItems(branch: RefDto, actions: BranchMenuActions): MenuItem[] {
  // 远程分支只读导航：绝不出现 switch/merge/rebase/删除，避免把只读引用当本地分支写。
  if (branch.kind === "remote_branch") {
    return remoteBranchMenuItems(branch, actions);
  }
  return [
    {
      label: i18next.t("repository.branchMenuSwitchTo"),
      disabled: actions.writeDisabled || branch.is_head,
      onSelect: () => actions.onSwitchBranch(branch),
    },
    {
      label: i18next.t("repository.branchMenuEditDescription"),
      disabled: actions.descriptionDisabled,
      onSelect: () => actions.onEditDescription(branch.short_name),
    },
    {
      label: i18next.t("repository.branchMenuCompareWithHead"),
      disabled: !actions.hasHead,
      onSelect: () => actions.onCompareWithHead(branch),
    },
    {
      label: i18next.t("repository.branchMenuSetBase"),
      onSelect: () => actions.onSetBase(branch),
    },
    {
      label: i18next.t("repository.branchMenuSetCompare"),
      onSelect: () => actions.onSetCompare(branch),
    },
    {
      label: i18next.t("repository.branchMenuMerge"),
      disabled: actions.writeDisabled || branch.is_head,
      onSelect: () => actions.onMergeBranch(branch.short_name),
    },
    {
      label: i18next.t("repository.branchMenuRebase"),
      disabled: actions.writeDisabled || branch.is_head,
      onSelect: () => actions.onRebaseBranch(branch.short_name),
    },
    {
      label: i18next.t("repository.branchMenuRename"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onRenameBranch(branch.short_name),
    },
    {
      label: i18next.t("repository.branchMenuDelete"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onDeleteBranch(branch.short_name),
    },
    {
      label: i18next.t("repository.branchMenuDeleteRemote"),
      disabled: actions.writeDisabled || !actions.hasRemoteTracking,
      onSelect: () => actions.onDeleteBranchRemote(branch.short_name),
    },
  ];
}
/** 远程分支右键菜单：检出为本地跟踪分支（写） + 对比与图谱导航（只读）。 */
export function remoteBranchMenuItems(branch: RefDto, actions: BranchMenuActions): MenuItem[] {
  return [
    {
      label: i18next.t("repository.branchMenuCheckoutRemote"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onCheckoutRemote(branch),
    },
    {
      label: i18next.t("repository.branchMenuSetBase"),
      onSelect: () => actions.onSetBase(branch),
    },
    {
      label: i18next.t("repository.branchMenuSetCompare"),
      onSelect: () => actions.onSetCompare(branch),
    },
    {
      label: i18next.t("repository.branchMenuCompareWithHead"),
      disabled: !actions.hasHead,
      onSelect: () => actions.onCompareWithHead(branch),
    },
    {
      label: i18next.t("repository.branchMenuFilterGraph"),
      onSelect: () => actions.onFilterGraph(branch),
    },
  ];
}
export interface TagMenuActions {
  writeDisabled: boolean;
  descriptionDisabled: boolean;
  /** 本地缓存里存在 origin 远程引用；决定「删除本地和远程标签」是否可用。 */
  hasOriginRemote: boolean;
  /** 仓库配置了至少一个远程；决定「推送标签到远程」是否可用（ADR-0028）。 */
  hasRemote: boolean;
  onSetBase: (tag: RefDto) => void;
  onSetCompare: (tag: RefDto) => void;
  onRevealCommit: (tag: RefDto) => void;
  onEditDescription: (tag: RefDto) => void;
  onDeleteTag: (name: string) => void;
  onDeleteTagRemote: (name: string) => void;
  /** 推送标签到远程（确认后执行 `git push <remote> refs/tags/<tag>`）。 */
  onPushTag: (tag: RefDto) => void;
}

/** 标签右键菜单：推送/对比/定位 + 编辑描述；删除分「仅本地」与「本地和远程」（ADR 0022 增补）。 */
export function tagMenuItems(tag: RefDto, actions: TagMenuActions): MenuItem[] {
  const hasCommit = Boolean(tag.commit_oid);
  return [
    {
      label: i18next.t("repository.tagMenuPush"),
      disabled: actions.writeDisabled || !actions.hasRemote,
      onSelect: () => actions.onPushTag(tag),
    },
    {
      label: i18next.t("repository.branchMenuSetBase"),
      disabled: !hasCommit,
      onSelect: () => actions.onSetBase(tag),
    },
    {
      label: i18next.t("repository.branchMenuSetCompare"),
      disabled: !hasCommit,
      onSelect: () => actions.onSetCompare(tag),
    },
    {
      label: i18next.t("repository.tagMenuRevealCommit"),
      disabled: !hasCommit,
      onSelect: () => actions.onRevealCommit(tag),
    },
    {
      label: i18next.t("repository.tagMenuEditDescription"),
      disabled: actions.descriptionDisabled || !tag.commit_oid,
      onSelect: () => actions.onEditDescription(tag),
    },
    {
      label: i18next.t("repository.tagMenuDelete"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onDeleteTag(tag.short_name),
    },
    {
      label: i18next.t("repository.tagMenuDeleteRemote"),
      disabled: actions.writeDisabled || !actions.hasOriginRemote,
      onSelect: () => actions.onDeleteTagRemote(tag.short_name),
    },
  ];
}