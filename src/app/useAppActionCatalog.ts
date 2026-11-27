import { useCallback } from "react";
import type { useBottomPanel } from "./useBottomPanel";
import type { useNarrowRefs } from "./useNarrowRefs";
import type { useRefActions } from "./useRefActions";
import type { useRemoteActions } from "./useRemoteActions";
import type { useRepoTabs } from "./useRepoTabs";
import type { useRepositorySession } from "./useRepositorySession";
import type { useSettingsEntry } from "./useSettingsEntry";
import type { useStashActions } from "./useStashActions";
import type { useTabController } from "./useTabController";
import type { ViewMode } from "./useGlobalEsc";
import type { useWriteFlow } from "./useWriteFlow";
import { commitSlot, type useCompareSlots } from "../features/compare/useCompare";
import { branchSlot } from "../features/repository/branchMenus";
import type {
  StagingActionBridgeRef,
  StagingActionSelection,
} from "../features/staging/stagingActionBridge";
import { copyText } from "../shared/clipboard";
import type { CommitSummaryDto, RefDto } from "../shared/types";
import type { ActionHandlers, ActionQueryState, ActionTarget } from "./actionCatalogTypes";
import { useActionCatalog } from "./useActionCatalog";

interface UseAppActionCatalogParams {
  session: ReturnType<typeof useRepositorySession>;
  tabs: ReturnType<typeof useRepoTabs>;
  tabCtrl: ReturnType<typeof useTabController>;
  slots: ReturnType<typeof useCompareSlots>;
  panel: ReturnType<typeof useBottomPanel>;
  remote: ReturnType<typeof useRemoteActions>;
  stash: ReturnType<typeof useStashActions>;
  write: ReturnType<typeof useWriteFlow>;
  refActions: ReturnType<typeof useRefActions>;
  settingsEntry: ReturnType<typeof useSettingsEntry>;
  refsUi: ReturnType<typeof useNarrowRefs>;
  refs: RefDto[];
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  selectedOid: string | null;
  setSelectedOid: (oid: string | null) => void;
  stagingBusy: boolean;
  stagingSelection: StagingActionSelection | null;
  stagingActionHandlersRef: StagingActionBridgeRef;
  locateFromSearch: (oid: string) => void;
  navigateRef: (ref: RefDto) => void;
  filterRef: (ref: RefDto) => void;
  copyDescription: (oid: string) => Promise<void>;
  compareWithHead: (branch: RefDto) => void;
  setOpenRepositoryOpen: (open: boolean) => void;
  setReflogOpen: (open: boolean) => void;
  setBranchCompareOpen: (open: boolean) => void;
}

export function useAppActionCatalog({
  session,
  tabs,
  tabCtrl,
  slots,
  panel,
  remote,
  stash,
  write,
  refActions,
  settingsEntry,
  refsUi,
  refs,
  mode,
  setMode,
  selectedOid,
  setSelectedOid,
  stagingBusy,
  stagingSelection,
  stagingActionHandlersRef,
  locateFromSearch,
  navigateRef,
  filterRef,
  copyDescription,
  compareWithHead,
  setOpenRepositoryOpen,
  setReflogOpen,
  setBranchCompareOpen,
}: UseAppActionCatalogParams) {
  const { repo, graph, busy } = session;
  const findCommit = useCallback(
    (oid: string): CommitSummaryDto | null => {
      for (const row of graph.view.rows) {
        if (row.commit?.oid === oid) {
          return row.commit;
        }
      }
      return null;
    },
    [graph.view.rows],
  );
  const commitForTarget = useCallback(
    (target: ActionTarget | null): CommitSummaryDto | null =>
      target?.kind === "commit" ? target.commit ?? findCommit(target.oid) : null,
    [findCommit],
  );
  const refForTarget = useCallback(
    (target: ActionTarget | null): RefDto | null =>
      target?.kind === "ref" ? target.ref : null,
    [],
  );
  const slotForTarget = useCallback(
    (target: ActionTarget | null) => {
      if (target?.kind === "ref") {
        return branchSlot(target.ref);
      }
      const commit = commitForTarget(target);
      return commit ? commitSlot(commit) : null;
    },
    [commitForTarget],
  );
  const openRepository = useCallback(() => {
    if (!tabs.busy) {
      setOpenRepositoryOpen(true);
    }
  }, [setOpenRepositoryOpen, tabs.busy]);

  const actionState: ActionQueryState = {
    repoOpen: Boolean(repo),
    repoBare: repo?.is_bare ?? false,
    busy: Boolean(
      busy ||
        tabs.busy ||
        write.busy ||
        write.validating ||
        remote.busy !== null ||
        stagingBusy ||
        session.opening,
    ),
    writeDisabled: write.disabled,
    view: repo ? mode : "welcome",
    selectedOid,
    hasHead: Boolean(repo && repo.head.kind !== "unborn" && repo.head.oid),
    compareReady: Boolean(slots.base && slots.compare),
    conflictedCount: session.workspace?.conflicted ?? 0,
    target:
      mode === "staging" && stagingSelection
        ? { kind: "staging-file", ...stagingSelection }
        : null,
    activeRepoId: tabs.activeId,
    compareRefCount: refs.filter((ref) => Boolean(ref.commit_oid)).length,
  };
  const actionHandlers: ActionHandlers = {
    "shell:showGraph": () => setMode("graph"),
    "shell:showStaging": () => setMode("staging"),
    "shell:openSearch": () => setMode("search"),
    "shell:toggleRefs": () => refsUi.toggleRefs(),
    "shell:refresh": () => {
      remote.clearError();
      void session.refresh();
    },
    "shell:openSettings": () => settingsEntry.openSettings(),
    "repository:open": openRepository,
    "repository:closeTab": (target) => {
      if (target?.kind === "repository") {
        void tabCtrl.closeTab(target.repoId);
      }
    },
    "repository:activateTab": (target) => {
      if (target?.kind === "repository") {
        void tabCtrl.activateTab(target.repoId);
      }
    },
    "repository:createBranch": () => refActions.openCreateBranch(),
    "repository:createTag": () => refActions.openCreateTag(),
    "graph:locateSelectedCommit": (target) => {
      if (target?.kind === "commit") {
        locateFromSearch(target.oid);
      }
    },
    "graph:openCommitDetail": (target) => {
      if (target?.kind === "commit") {
        setSelectedOid(target.oid);
        setMode("graph");
      }
    },
    "graph:copyCommitHash": (target) => {
      if (target?.kind === "commit") {
        void copyText(target.oid);
      }
    },
    "graph:copyCommitMessage": (target) => {
      if (target?.kind === "commit") {
        void copyDescription(target.oid);
      }
    },
    "graph:createBranchHere": (target) => {
      const commit = commitForTarget(target);
      if (commit) {
        refActions.openCreateBranch(commit);
      }
    },
    "graph:createTagHere": (target) => {
      const commit = commitForTarget(target);
      if (commit) {
        refActions.openCreateTag(commit);
      }
    },
    "graph:cherryPickCommit": (target) => {
      const commit = commitForTarget(target);
      if (commit) {
        write.menuWriteActions.onCherryPick(commit);
      }
    },
    "graph:revertCommit": (target) => {
      const commit = commitForTarget(target);
      if (commit) {
        write.menuWriteActions.onRevert(commit);
      }
    },
    "graph:resetBranchHere": (target) => {
      const commit = commitForTarget(target);
      if (commit) {
        write.menuWriteActions.onResetHere(commit);
      }
    },
    "graph:openReflog": () => setReflogOpen(true),
    "compare:openResults": () => setMode("compare"),
    "compare:pickBranches": () => setBranchCompareOpen(true),
    "compare:swapSides": () => slots.swap(),
    "compare:setBase": (target) => {
      const slot = slotForTarget(target);
      if (slot) {
        slots.setSide("base", slot);
      }
    },
    "compare:setCompare": (target) => {
      const slot = slotForTarget(target);
      if (slot) {
        slots.setSide("compare", slot);
      }
    },
    "refs:locateCommit": (target) => {
      const ref = refForTarget(target);
      if (ref) {
        navigateRef(ref);
      }
    },
    "refs:filterGraph": (target) => {
      const ref = refForTarget(target);
      if (ref) {
        filterRef(ref);
      }
    },
    "refs:compareWithHead": (target) => {
      const ref = refForTarget(target);
      if (ref) {
        compareWithHead(ref);
      }
    },
    "refs:switchBranch": (target) => {
      const ref = refForTarget(target);
      if (ref) {
        void write.start("switch_branch", { branch: ref.short_name });
      }
    },
    "staging:showConflicts": () => {
      stash.closeStash();
      setSelectedOid(null);
      setMode("staging");
    },
    "staging:refresh": () => stagingActionHandlersRef.current?.refresh(),
    "staging:stageFile": (target) => {
      if (target?.kind === "staging-file") {
        stagingActionHandlersRef.current?.stageFile(target.path);
      }
    },
    "staging:unstageFile": (target) => {
      if (target?.kind === "staging-file") {
        stagingActionHandlersRef.current?.unstageFile(target.path);
      }
    },
    "staging:discardFile": (target) => {
      if (target?.kind === "staging-file") {
        stagingActionHandlersRef.current?.discardFile(target.path);
      }
    },
    "terminal:toggle": () => panel.toggleTerminal(),
  };

  return useActionCatalog({ state: actionState, handlers: actionHandlers });
}
