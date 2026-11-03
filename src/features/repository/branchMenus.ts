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
  hasHead: boolean;
  onEditDescription: (shortName: string) => void;
  onCompareWithHead: (branch: RefDto) => void;
  onSetBase: (branch: RefDto) => void;
  onSetCompare: (branch: RefDto) => void;
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
  ];
}
