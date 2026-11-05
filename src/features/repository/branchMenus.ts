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
  onEditDescription: (shortName: string) => void;
  onCompareWithHead: (branch: RefDto) => void;
  onSetBase: (branch: RefDto) => void;
  onSetCompare: (branch: RefDto) => void;
  onRenameBranch: (shortName: string) => void;
  onDeleteBranch: (shortName: string) => void;
  onDeleteBranchRemote: (name: string) => void;
  onMergeBranch: (shortName: string) => void;
  onRebaseBranch: (shortName: string) => void;
}

export function branchMenuItems(branch: RefDto, actions: BranchMenuActions): MenuItem[] {
  return [
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
export interface TagMenuActions {
  writeDisabled: boolean;
  onDeleteTag: (name: string) => void;
}

/** 标签右键菜单：删除入口与分支统一，避免侧栏堆叠「删除」链接。 */
export function tagMenuItems(tag: RefDto, actions: TagMenuActions): MenuItem[] {
  return [
    {
      label: i18next.t("repository.tagMenuDelete"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onDeleteTag(tag.short_name),
    },
  ];
}