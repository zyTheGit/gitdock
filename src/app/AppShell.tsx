import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppDialogs } from "./AppDialogs";
import type { AppShellProps } from "./appShellTypes";
import { MainWorkspace } from "./MainWorkspace";
import { PanelArea } from "./PanelArea";
import { RefsPopover } from "./RefsPopover";
import { RepoTabBar } from "./RepoTabBar";
import { RepositorySidebar } from "./RepositorySidebar";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { TopBar } from "./TopBar";
import { SIDEBAR_WIDTH } from "./usePaneWidths";
import { REFS_POPOVER_ID } from "./useNarrowRefs";
import { pendingUpdate } from "./useUpdateCheck";
import type { ActionId } from "./actionCatalogTypes";
import { OperationNoticeStack } from "./OperationNoticeView";
import {
  bindOperationNoticeRepo,
  dismissOperationNotice,
  getOperationNoticeSnapshot,
  subscribeOperationNotice,
  type OperationNoticeAction,
} from "./operationNotice";
import { OpenRepositoryDialog } from "../features/repository/OpenRepositoryDialog";
import { CommandPalette } from "../features/commands/CommandPalette";
import { useI18n } from "../i18n";
import { PaneSplitter } from "../shared/PaneSplitter";
import { displaySpec, useBindings } from "../shared/keybindings";
import type { RefDto } from "../shared/types";

/** 主壳装配与布局；统一仓库弹层的开合在此持有，其余状态与回调来自 App。 */
export function AppShell({
  session,
  tabs,
  tabCtrl,
  tabState,
  slots,
  compare,
  search,
  searchCommits,
  graph,
  panel,
  remote,
  stash,
  write,
  refActions,
  commitMenus,
  panes,
  settingsEntry,
  zoom,
  language,
  updateState,
  refs,
  tools,
  headLabel,
  selectedOid,
  focusTarget,
  pathFilter,
  twoDot,
  rowMenu,
  branchMenu,
  tagMenu,
  branchCompareOpen,
  descriptionBranch,
  descriptionTag,
  launchExternal,
  launchDirectoryDiff,
  stagingMutated,
  locateFromSearch,
  searchOpen,
  onToggleSearch,
  closeSearch,
  onCopyOid,
  onOpenUpdate,
  onCloseBranchCompare,
  onConfirmBranchCompare,
  onBranchMenu,
  onTagMenu,
  onCloseRowMenu,
  onCloseBranchMenu,
  onCloseTagMenu,
  onCloseDescriptionBranch,
  onCloseDescriptionTag,
  onDescriptionSaved,
  onFocusTarget,
  onRowMenu,
  onStagingBusy,
  refsUi,
  stagingBusy,
  stagingActionHandlersRef,
  setStagingSelection,
  openRepositoryOpen,
  setOpenRepositoryOpen,
  reflogOpen,
  setReflogOpen,
  commandPaletteOpen,
  setCommandPaletteOpen,
  actions,
}: AppShellProps) {
  const { t } = useI18n();
  const { repo, info, settings, workspace, busy, opening, error, diagnostic, toast, setToast, setError, setDiagnostic, setSettings } =
    session;
  const { mode, scope, setScope, setSelectedOid, setMode, setPathFilter, setTwoDot } = tabState;
  const bindings = useBindings();
  const updateVersion = pendingUpdate(updateState)?.latest_version ?? null;
  const repoPath = repo?.path ?? null;
  bindOperationNoticeRepo(repoPath, tabs.activeId);
  const noticeSnapshot = useSyncExternalStore(
    subscribeOperationNotice,
    getOperationNoticeSnapshot,
    getOperationNoticeSnapshot,
  );
  const noticeBusy =
    busy || tabs.busy || write.busy || write.validating || remote.busy !== null || stagingBusy;
  const resolveNoticeAction = useCallback(
    (action: OperationNoticeAction): OperationNoticeAction => {
      let disabledReason: string | undefined = noticeBusy ? t("notices.actionBusy") : undefined;
      if (action.target === "head") {
        const oid = action.oid ?? (repo?.head.kind === "unborn" ? undefined : repo?.head.oid);
        if (!oid && !disabledReason) {
          disabledReason = t("notices.actionNoHead");
        }
        return { ...action, oid, disabledReason };
      }
      if (action.target === "conflicts") {
        if (!repo && !disabledReason) {
          disabledReason = t("notices.actionUnavailable");
        } else if (workspace?.conflicted === 0 && !disabledReason) {
          disabledReason = t("notices.actionNoConflicts");
        }
        return { ...action, disabledReason };
      }
      if (action.target === "reflog" && !repo && !disabledReason) {
        disabledReason = t("notices.actionUnavailable");
      }
      if (action.target === "remote" && remote.disabled && !disabledReason) {
        disabledReason = t("notices.actionUnavailable");
      }
      return { ...action, disabledReason };
    },
    [noticeBusy, remote.disabled, repo, t, workspace?.conflicted],
  );
  const resolvedNotices = noticeSnapshot.notices.map((notice) => ({
    ...notice,
    actions: notice.actions?.map(resolveNoticeAction),
  }));
  const dismissNotice = useCallback((id: number) => dismissOperationNotice(id), []);
  const handleNoticeAction = useCallback(
    (action: OperationNoticeAction) => {
      // refActions/stash 未暴露 dialog busy；动作触发前按最新已知状态重新计算 disabled。
      const resolved = resolveNoticeAction(action);
      if (resolved.disabledReason) {
        return;
      }
      if (resolved.target === "head" && resolved.oid) {
        actions.execute("graph:locateSelectedCommit", { kind: "commit", oid: resolved.oid });
      } else if (resolved.target === "reflog") {
        actions.execute("graph:openReflog");
      } else if (resolved.target === "conflicts") {
        actions.execute("staging:showConflicts");
      } else if (resolved.target === "remote") {
        // remote.run 自身有同步 ref 占锁，同 tick 连点不会重复 validate/execute。
        remote.run(resolved.operation);
      }
    },
    [actions, remote, resolveNoticeAction],
  );
  const handleStagingBusy = useCallback(
    (value: boolean) => {
      onStagingBusy(value);
    },
    [onStagingBusy],
  );

  useEffect(() => {
    setToast(null);
  }, [repoPath, setToast]);

  const statusBarProps: StatusBarProps = {
    busy,
    repo,
    info,
    settings,
    fontScale: zoom.fontScale,
    terminalActive: panel.panelOpen && panel.activeTab === "terminal",
    terminalRunning: panel.terminalRunning,
    terminalShortcut: displaySpec(bindings["terminal.toggle"]),
    commandPaletteShortcut: displaySpec(bindings["app.commandPalette"]),
    updateVersion,
    onToggleTerminal: () => actions.execute("terminal:toggle"),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onOpenUpdate,
  };

  const sidebarProps = {
    repo,
    headLabel,
    refs,
    writeDisabled: write.disabled,
    onSwitchBranch: (branch: RefDto) =>
      actions.execute("refs:switchBranch", { kind: "ref", ref: branch }),
    onNavigateRef: (ref: RefDto) =>
      actions.execute("refs:locateCommit", { kind: "ref", ref }),
    onCopyOid,
    onBranchMenu,
    onCreateBranch: () => actions.execute("repository:createBranch"),
    onTagMenu,
    onOpenWorktree: (path: string) => {
      refsUi.closeRefs();
      void session.open(path);
    },
  };

  const applyMode: typeof setMode = (next) => {
    if (next === "graph") {
      actions.execute("shell:showGraph");
    } else if (next === "staging") {
      actions.execute("shell:showStaging");
    } else {
      actions.execute("compare:openResults");
    }
  };

  return (
    <div className="app">
      <TopBar
        repo={repo}
        workspace={workspace}
        tabs={tabs.tabs}
        activeRepoId={tabs.activeId}
        recent={settings?.recent_repositories ?? []}
        busy={noticeBusy}
        mode={mode}
        compareReady={Boolean(slots.base && slots.compare)}
        refCount={refs.length}
        narrow={refsUi.isNarrow}
        refsOpen={refsUi.isOpen}
        sidebarVisible={refsUi.sidebarVisible}
        onToggleRefs={() => actions.execute("shell:toggleRefs")}
        refsButtonRef={refsUi.triggerRef}
        refsPopoverId={REFS_POPOVER_ID}
        onActivateRepo={(repoId) =>
          actions.execute("repository:activateTab", { kind: "repository", repoId })
        }
        onOpenRepo={(path) => void session.open(path)}
        onForgetRepo={(path) => void session.forget(path)}
        onPickRepo={() => void session.pick()}
        onRefresh={() => actions.execute("shell:refresh")}
        onOpenSettings={() => actions.execute("shell:openSettings")}
        searchOpen={searchOpen}
        onToggleSearch={onToggleSearch}
        setMode={applyMode}
        onOpenBranchCompare={() => actions.execute("compare:pickBranches")}
      />
      <RepoTabBar
        tabs={tabs.tabs}
        activeId={tabs.activeId}
        dirtyIds={tabs.dirtyIds}
        busy={tabs.busy || remote.busy !== null}
        opening={opening}
        onActivate={(repoId) =>
          actions.execute("repository:activateTab", { kind: "repository", repoId })
        }
        onClose={(repoId) =>
          actions.execute("repository:closeTab", { kind: "repository", repoId })
        }
      />
      {refsUi.isNarrow && refsUi.isOpen && repo && (
        <RefsPopover
          {...sidebarProps}
          id={REFS_POPOVER_ID}
          open
          onClose={refsUi.closeRefs}
          triggerRef={refsUi.triggerRef}
        />
      )}

      <div className="layout">
        {!refsUi.isNarrow && refsUi.sidebarVisible && (
          <>
            <RepositorySidebar
              {...sidebarProps}
              width={panes.sidebarWidth}
            />
            <PaneSplitter
              label={t("shell.sidebarResizeLabel")}
              width={panes.sidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={SIDEBAR_WIDTH.max}
              defaultValue={SIDEBAR_WIDTH.reset}
              onChange={panes.setSidebarWidth}
            />
          </>
        )}

        <MainWorkspace
          repo={repo}
          changeTick={session.changeTick}
          scrollRestore={tabState.scrollRestore}
          info={info}
          busy={busy || tabs.busy}
          opening={opening}
          error={error}
          diagnostic={diagnostic}
          mode={mode}
          scope={scope}
          selectedOid={selectedOid}
          focusTarget={focusTarget}
          pathFilter={pathFilter}
          twoDot={twoDot}
          tools={tools}
          defaultTool={settings?.default_tool ?? null}
          slots={slots}
          compare={compare}
          commitMenus={commitMenus}
          write={write}
          remote={remote}
          panes={panes}
          graph={graph}
          panel={panel}
          stash={stash}
          launchExternal={launchExternal}
          launchDirectoryDiff={launchDirectoryDiff}
          stagingMutated={stagingMutated}
          stagingActionHandlersRef={stagingActionHandlersRef}
          onStagingSelectionChange={setStagingSelection}
          reflogOpen={reflogOpen}
          setReflogOpen={setReflogOpen}
          reflogWriteDisabled={noticeBusy || write.disabled}
          onCreateBranch={refActions.openCreateBranch}
          onPick={() => actions.execute("repository:open")}
          setters={{
            setMode,
            setScope,
            setSelectedOid,
            setFocusTarget: onFocusTarget,
            setPathFilter,
            setTwoDot,
            setRowMenu: onRowMenu,
            setStagingBusy: handleStagingBusy,
            setError,
            setDiagnostic,
            setToast,
          }}
        />
      </div>
      <PanelArea
        panel={panel}
        terminals={tabCtrl.terminals}
        activeRepoId={tabs.activeId}
        terminalEnabled={Boolean(repo)}
        lazygitConfig={settings?.lazygit_path ?? ""}
        shellProfile={settings?.shell_profile === "git_bash" ? "git_bash" : "default"}
        onShellProfileSaved={setSettings}
        onOpenSettings={() => actions.execute("shell:openSettings")}
        onTerminalRunningChange={tabCtrl.handleTerminalRunning}
        onTerminalRepoChanged={tabCtrl.handleTerminalRepoChanged}
        terminalShortcut={displaySpec(bindings["terminal.toggle"])}
      />
      <StatusBar {...statusBarProps} />
      {openRepositoryOpen && (
        <OpenRepositoryDialog
          currentPath={repo?.path ?? null}
          recent={settings?.recent_repositories ?? []}
          busy={busy || tabs.busy}
          onOpen={(path) => void session.open(path)}
          onForget={session.forget}
          onPick={() => void session.pick()}
          onClose={() => setOpenRepositoryOpen(false)}
        />
      )}
      <AppDialogs
        repo={repo}
        searchOpen={searchOpen}
        settings={settings}
        info={info}
        toast={toast}
        notice={null}
        onDismissNotice={dismissNotice}
        onNoticeAction={handleNoticeAction}
        search={search}
        searchCommits={searchCommits}
        onLocateCommit={locateFromSearch}
        onCloseSearch={closeSearch}
        commitMenus={commitMenus}
        rowMenu={rowMenu}
        branchMenu={branchMenu}
        tagMenu={tagMenu}
        onRowClose={onCloseRowMenu}
        onBranchClose={onCloseBranchMenu}
        onTagClose={onCloseTagMenu}
        descriptionBranch={descriptionBranch}
        descriptionTag={descriptionTag}
        onCloseDescriptionBranch={onCloseDescriptionBranch}
        onCloseDescriptionTag={onCloseDescriptionTag}
        onDescriptionSaved={(message) => void onDescriptionSaved(message)}
        write={write}
        refDialogs={refActions.dialogs}
        stashDialog={stash.dialog}
        branchCompareOpen={branchCompareOpen}
        refs={refs}
        headBranch={repo?.head.branch ?? null}
        initialBase={slots.base?.label}
        initialCompare={slots.compare?.label}
        onCloseBranchCompare={onCloseBranchCompare}
        onConfirmBranchCompare={onConfirmBranchCompare}
        settingsEntry={settingsEntry}
        zoom={zoom}
        language={language}
        updateCheck={updateState}
        onSettingsSaved={setSettings}
        onSettingsError={setError}
      />
      {resolvedNotices.length > 0 && (
        <OperationNoticeStack
          notices={resolvedNotices}
          onDismiss={dismissNotice}
          onAction={handleNoticeAction}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          items={actions.items}
          onExecute={(id) => actions.execute(id as ActionId)}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
    </div>
  );
}
