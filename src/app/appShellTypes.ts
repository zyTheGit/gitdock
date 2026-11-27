import type { MouseEvent } from "react";
import type { CompareLoader, useCompareSlots } from "../features/compare/useCompare";
import type { useSearch } from "../features/search/useSearch";
import type {
  StagingActionBridgeRef,
  StagingActionSelection,
} from "../features/staging/stagingActionBridge";
import type { useAppLanguage } from "../i18n/useAppLanguage";
import type { CommitSummaryDto, ExternalToolConfig, RefDto } from "../shared/types";
import type { useActionCatalog } from "./useActionCatalog";
import type { useBottomPanel } from "./useBottomPanel";
import type {
  BranchMenuState,
  RowMenuState,
  TagMenuState,
  useCommitMenus,
} from "./useCommitMenus";
import type { useFontScale } from "./useFontScale";
import type { useNarrowRefs } from "./useNarrowRefs";
import type { usePaneWidths } from "./usePaneWidths";
import type { useRefActions } from "./useRefActions";
import type { useRemoteActions } from "./useRemoteActions";
import type { useRepoTabs } from "./useRepoTabs";
import type { useRepoTabState } from "./useRepoTabState";
import type { useRepositorySession } from "./useRepositorySession";
import type { useSettingsEntry } from "./useSettingsEntry";
import type { useStashActions } from "./useStashActions";
import type { useTabController } from "./useTabController";
import type { useUpdateCheck } from "./useUpdateCheck";
import type { useWriteFlow } from "./useWriteFlow";

export interface AppShellProps {
  session: ReturnType<typeof useRepositorySession>;
  tabs: ReturnType<typeof useRepoTabs>;
  tabCtrl: ReturnType<typeof useTabController>;
  tabState: ReturnType<typeof useRepoTabState>;
  slots: ReturnType<typeof useCompareSlots>;
  compare: CompareLoader;
  search: ReturnType<typeof useSearch>;
  searchCommits: CommitSummaryDto[];
  graph: ReturnType<typeof useRepositorySession>["graph"];
  panel: ReturnType<typeof useBottomPanel>;
  remote: ReturnType<typeof useRemoteActions>;
  stash: ReturnType<typeof useStashActions>;
  write: ReturnType<typeof useWriteFlow>;
  refActions: ReturnType<typeof useRefActions>;
  commitMenus: ReturnType<typeof useCommitMenus>;
  panes: ReturnType<typeof usePaneWidths>;
  settingsEntry: ReturnType<typeof useSettingsEntry>;
  zoom: ReturnType<typeof useFontScale>;
  language: ReturnType<typeof useAppLanguage>;
  updateState: ReturnType<typeof useUpdateCheck>;
  refs: RefDto[];
  tools: ExternalToolConfig[];
  headLabel: string;
  selectedOid: string | null;
  focusTarget: { oid: string; seq: number } | null;
  pathFilter: string;
  twoDot: boolean;
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  tagMenu: TagMenuState | null;
  branchCompareOpen: boolean;
  descriptionBranch: string | null;
  descriptionTag: RefDto | null;
  launchExternal: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
    threeDot: boolean,
  ) => void;
  launchDirectoryDiff: (toolIndex: number) => void;
  stagingMutated: (message: string) => Promise<void>;
  locateFromSearch: (oid: string) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  closeSearch: () => void;
  onCopyOid: (oid: string) => void;
  onOpenUpdate: () => void;
  onCloseBranchCompare: () => void;
  onConfirmBranchCompare: (base: RefDto, compare: RefDto) => void;
  onBranchMenu: (event: MouseEvent, branch: RefDto) => void;
  onTagMenu: (event: MouseEvent, tag: RefDto) => void;
  onCloseRowMenu: () => void;
  onCloseBranchMenu: () => void;
  onCloseTagMenu: () => void;
  onCloseDescriptionBranch: () => void;
  onCloseDescriptionTag: () => void;
  onDescriptionSaved: (message: string) => void;
  onFocusTarget: (target: { oid: string; seq: number } | null) => void;
  onRowMenu: (state: RowMenuState | null) => void;
  onStagingBusy: (busy: boolean) => void;
  refsUi: ReturnType<typeof useNarrowRefs>;
  stagingBusy: boolean;
  stagingActionHandlersRef: StagingActionBridgeRef;
  setStagingSelection: (selection: StagingActionSelection | null) => void;
  openRepositoryOpen: boolean;
  setOpenRepositoryOpen: (open: boolean) => void;
  reflogOpen: boolean;
  setReflogOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  actions: ReturnType<typeof useActionCatalog>;
}
