import type { MenuItem } from "../../shared/ContextMenu";
import type { CommitSummaryDto } from "../../shared/types";

export interface CommitMenuActions {
  writeDisabled: boolean;
  onCopyHash: (oid: string) => void;
  onCopyMessage: (oid: string) => void;
  onCherryPick: (commit: CommitSummaryDto) => void;
  onRevert: (commit: CommitSummaryDto) => void;
}

export function commitMenuItems(commit: CommitSummaryDto, actions: CommitMenuActions): MenuItem[] {
  return [
    { label: "复制完整哈希", onSelect: () => actions.onCopyHash(commit.oid) },
    { label: "复制提交说明", onSelect: () => actions.onCopyMessage(commit.oid) },
    {
      label: "Cherry Pick 此提交",
      disabled: actions.writeDisabled,
      onSelect: () => actions.onCherryPick(commit),
    },
    {
      label: "Revert 此提交",
      disabled: actions.writeDisabled,
      onSelect: () => actions.onRevert(commit),
    },
  ];
}

export interface RowMenuActions extends CommitMenuActions {
  onSetBase: (commit: CommitSummaryDto) => void;
  onSetCompare: (commit: CommitSummaryDto) => void;
  onOpenDetail: (commit: CommitSummaryDto) => void;
}

export function rowMenuItems(commit: CommitSummaryDto, actions: RowMenuActions): MenuItem[] {
  return [
    ...commitMenuItems(commit, actions),
    { label: "设为 Base", onSelect: () => actions.onSetBase(commit) },
    { label: "设为 Compare", onSelect: () => actions.onSetCompare(commit) },
    { label: "查看详情", onSelect: () => actions.onOpenDetail(commit) },
  ];
}
