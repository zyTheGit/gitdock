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
  hasHead: boolean;
  onEditDescription: (shortName: string) => void;
  onCompareWithHead: (branch: RefDto) => void;
  onSetBase: (branch: RefDto) => void;
  onSetCompare: (branch: RefDto) => void;
}

export function branchMenuItems(branch: RefDto, actions: BranchMenuActions): MenuItem[] {
  return [
    {
      label: "编辑描述",
      disabled: actions.descriptionDisabled,
      onSelect: () => actions.onEditDescription(branch.short_name),
    },
    {
      label: "与 HEAD 对比",
      disabled: !actions.hasHead,
      onSelect: () => actions.onCompareWithHead(branch),
    },
    { label: "设为对比 Base", onSelect: () => actions.onSetBase(branch) },
    { label: "设为对比 Compare", onSelect: () => actions.onSetCompare(branch) },
  ];
}
