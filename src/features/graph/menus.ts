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
  onNewBranch: (commit: CommitSummaryDto) => void;
  onNewTag: (commit: CommitSummaryDto) => void;
  onBatchCherryPick: (commits: CommitSummaryDto[]) => void;
  onBatchRevert: (commits: CommitSummaryDto[]) => void;
}

/** 右键落在选中集合内时，菜单顶部出现批量操作；顺序沿用用户选择顺序。 */
function batchMenuItems(
  commit: CommitSummaryDto,
  selection: CommitSummaryDto[],
  actions: RowMenuActions,
): MenuItem[] {
  if (selection.length < 2 || !selection.some((item) => item.oid === commit.oid)) {
    return [];
  }
  return [
    {
      label: i18next.t("graph.menuBatchCherryPick", { n: selection.length }),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onBatchCherryPick(selection),
    },
    {
      label: i18next.t("graph.menuBatchRevert", { n: selection.length }),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onBatchRevert(selection),
    },
  ];
}

export function rowMenuItems(
  commit: CommitSummaryDto,
  actions: RowMenuActions,
  selection: CommitSummaryDto[] = [],
): MenuItem[] {
  return [
    ...batchMenuItems(commit, selection, actions),
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
    {
      label: i18next.t("graph.menuCreateBranchHere"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onNewBranch(commit),
    },
    {
      label: i18next.t("graph.menuCreateTagHere"),
      disabled: actions.writeDisabled,
      onSelect: () => actions.onNewTag(commit),
    },
  ];
}