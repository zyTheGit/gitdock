import type { MouseEvent } from "react";
import { AppDialogs } from "./AppDialogs";
import { MainWorkspace } from "./MainWorkspace";
import { PanelArea } from "./PanelArea";
import { RepoTabBar } from "./RepoTabBar";
import { RepositorySidebar } from "./RepositorySidebar";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { TopBar } from "./TopBar";
import type { BranchMenuState, RowMenuState, TagMenuState, useCommitMenus } from "./useCommitMenus";
import type { useBottomPanel } from "./useBottomPanel";
import type { useFontScale } from "./useFontScale";
import { SIDEBAR_WIDTH } from "./usePaneWidths";
import type { usePaneWidths } from "./usePaneWidths";
import type { useRefActions } from "./useRefActions";
import type { useRemoteActions } from "./useRemoteActions";
import type { useRepoTabs } from "./useRepoTabs";
import type { useRepoTabState } from "./useRepoTabState";
import type { useRepositorySession } from "./useRepositorySession";
import type { useSettingsEntry } from "./useSettingsEntry";
import type { useStashActions } from "./useStashActions";
import type { useTabController } from "./useTabController";
import { pendingUpdate, type useUpdateCheck } from "./useUpdateCheck";
import type { useWriteFlow } from "./useWriteFlow";
import type { useCompareSlots } from "../features/compare/useCompare";
import type { CompareLoader } from "../features/compare/useCompare";
import type { useSearch } from "../features/search/useSearch";
import { useI18n } from "../i18n";
import type { useAppLanguage } from "../i18n/useAppLanguage";
import { PaneSplitter } from "../shared/PaneSplitter";
import { displaySpec, useBindings } from "../shared/keybindings";
import type { CommitSummaryDto, ExternalToolConfig, RefDto } from "../shared/types";

interface AppShellProps {
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
  closeSearch: () => void;
  onNavigateRef: (ref: RefDto) => void;
  onCopyOid: (oid: string) => void;
  onOpenUpdate: () => void;
  onOpenBranchCompare: () => void;
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
}

/** 主壳渲染层：只做装配与布局，状态与回调全部来自 App（T01 拆分，行为不变）。 */
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
  closeSearch,
  onNavigateRef,
  onCopyOid,
  onOpenUpdate,
  onOpenBranchCompare,
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
}: AppShellProps) {
  const { t } = useI18n();
  const { repo, info, settings, workspace, busy, opening, error, diagnostic, toast, setError, setDiagnostic, setSettings } =
    session;
  const { mode, scope, setScope, setSelectedOid, setMode, setPathFilter, setTwoDot } = tabState;
  const bindings = useBindings();
  const updateVersion = pendingUpdate(updateState)?.latest_version ?? null;

  const statusBarProps: StatusBarProps = {
    busy,
    repo,
    info,
    settings,
    fontScale: zoom.fontScale,
    terminalActive: panel.panelOpen && panel.activeTab === "terminal",
    terminalRunning: panel.terminalRunning,
    terminalShortcut: displaySpec(bindings["terminal.toggle"]),
    updateVersion,
    onToggleTerminal: panel.toggleTerminal,
    onOpenUpdate,
  };

  const switchBranch = (branch: RefDto) => void write.start("switch_branch", { branch: branch.short_name });

  return (
    <div className="app">
      <TopBar
        repo={repo}
        workspace={workspace}
        recent={settings?.recent_repositories ?? []}
        busy={busy}
        mode={mode}
        compareReady={Boolean(slots.base && slots.compare)}
        refCount={refs.length}
        onOpenRepo={(path) => void session.open(path)}
        onForgetRepo={(path) => void session.forget(path)}
        onPickRepo={() => void session.pick()}
        onRefresh={() => {
          remote.clearError();
          void session.refresh();
        }}
        onOpenSettings={() => settingsEntry.openSettings()}
        closeSearch={closeSearch}
        setMode={setMode}
        onOpenBranchCompare={onOpenBranchCompare}
      />
      {tabs.tabs.length > 0 && (
        <RepoTabBar
          tabs={tabs.tabs}
          activeId={tabs.activeId}
          dirtyIds={tabs.dirtyIds}
          busy={tabs.busy}
          opening={opening}
          onActivate={(repoId) => void tabCtrl.activateTab(repoId)}
          onClose={(repoId) => void tabCtrl.closeTab(repoId)}
          onOpen={() => void session.pick()}
        />
      )}

      <div className="layout">
        <RepositorySidebar
          width={panes.sidebarWidth}
          repo={repo}
          headLabel={headLabel}
          refs={refs}
          writeDisabled={write.disabled}
          onCompareBranches={onOpenBranchCompare}
          onSwitchBranch={switchBranch}
          onNavigateRef={onNavigateRef}
          onCopyOid={onCopyOid}
          onBranchMenu={onBranchMenu}
          onCreateBranch={() => refActions.openCreateBranch()}
          onTagMenu={onTagMenu}
          onOpenWorktree={(path) => void session.open(path)}
        />
        <PaneSplitter
          label={t("shell.sidebarResizeLabel")}
          width={panes.sidebarWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          defaultValue={SIDEBAR_WIDTH.reset}
          onChange={panes.setSidebarWidth}
        />

        <MainWorkspace
          repo={repo}
          repoId={tabs.activeId}
          scrollRestore={tabState.scrollRestore}
          info={info}
          busy={busy}
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
          onCreateBranch={refActions.openCreateBranch}
          onPick={() => void session.pick()}
          setters={{
            setMode,
            setScope,
            setSelectedOid,
            setFocusTarget: onFocusTarget,
            setPathFilter,
            setTwoDot,
            setRowMenu: onRowMenu,
            setStagingBusy: onStagingBusy,
            setError,
            setDiagnostic,
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
        onOpenSettings={() => settingsEntry.openSettings()}
        onTerminalRunningChange={tabCtrl.handleTerminalRunning}
        onTerminalRepoChanged={tabCtrl.handleTerminalRepoChanged}
        terminalShortcut={displaySpec(bindings["terminal.toggle"])}
      />
      <StatusBar {...statusBarProps} />
      <AppDialogs
        repo={repo}
        mode={mode}
        settings={settings}
        info={info}
        toast={toast}
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
    </div>
  );
}
