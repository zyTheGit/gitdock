import { i18next } from "../../i18n";
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
    {
      label: i18next.t("graph.menuCopyFullHash"),
      onSelect: () => actions.onCopyHash(commit.oid),
    },
    {
      label: i18next.t("graph.menuCopyMessage"),
      onSelect: () => actions.onCopyMessage(commit.oid),
    },
    {
      label: i18next.t("graph.menuCherryPick"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onCherryPick(commit),
    },
    {
      label: i18next.t("graph.menuRevert"),
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
    {
      label: i18next.t("graph.menuSetBase"),
      onSelect: () => actions.onSetBase(commit),
    },
    {
      label: i18next.t("graph.menuSetCompare"),
      onSelect: () => actions.onSetCompare(commit),
    },
    {
      label: i18next.t("graph.menuOpenDetail"),
      onSelect: () => actions.onOpenDetail(commit),
    },
  ];
}
