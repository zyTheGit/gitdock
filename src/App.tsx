import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app/AppShell";
import { useCommitMenus, type BranchMenuState, type RowMenuState, type TagMenuState } from "./app/useCommitMenus";
import { useAppActionCatalog } from "./app/useAppActionCatalog";
import { useCommandPaletteShortcut } from "./app/useCommandPaletteShortcut";
import { useNarrowRefs } from "./app/useNarrowRefs";
import { useGlobalEsc } from "./app/useGlobalEsc";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { useBottomPanel } from "./app/useBottomPanel";
import { useDirectoryDiff } from "./app/useDirectoryDiff";
import { formatHeadLabel } from "./app/headLabel";
import { usePaneWidths } from "./app/usePaneWidths";
import { useFontScale } from "./app/useFontScale";
import { useAppLanguage } from "./i18n/useAppLanguage";
import { useI18n } from "./i18n";
import { useRefActions } from "./app/useRefActions";
import { useRefNavigation } from "./app/useRefNavigation";
import { useRemoteActions } from "./app/useRemoteActions";
import { useStashActions } from "./app/useStashActions";
import { useRepositorySession } from "./app/useRepositorySession";
import { useRepoTabs, type RepoOpenResult } from "./app/useRepoTabs";
import { useRepoTabState, useTabSelectionGuard } from "./app/useRepoTabState";
import { useSettingsEntry } from "./app/useSettingsEntry";
import { useStartupRestore } from "./app/useStartupRestore";
import { useTabController } from "./app/useTabController";
import { openReleasePage, runUpdateCheck, useUpdateCheck } from "./app/useUpdateCheck";
import { useWriteFlow } from "./app/useWriteFlow";
import { useCompareResult, useCompareSlots } from "./features/compare/useCompare";
import { branchSlot } from "./features/repository/branchMenus";
import type {
  StagingActionHandlers,
  StagingActionSelection,
} from "./features/staging/stagingActionBridge";
import { useSearch } from "./features/search/useSearch";
import { copyText } from "./shared/clipboard";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import { initPlatform } from "./shared/platform";
import type { RefDto } from "./shared/types";

export default function App() {
  const { t } = useI18n();
  // 每标签视图态（scope / 选中 / 模式 / 过滤 / 滚动）；切标签时先快照再恢复（ADR-0032）。
  const tabState = useRepoTabState();
  const { scope, setScope, selectedOid, setSelectedOid, mode, setMode } = tabState;
  const { pathFilter, twoDot } = tabState;
  // 搜索定位请求：seq 递增，保证同一提交再次定位时也会重新滚动一次。
  const focusSeq = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ oid: string; seq: number } | null>(null);

  const panel = useBottomPanel();
  const [branchCompareOpen, setBranchCompareOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  const [descriptionBranch, setDescriptionBranch] = useState<string | null>(null);
  const [descriptionTag, setDescriptionTag] = useState<RefDto | null>(null);
  const [stagingBusy, setStagingBusy] = useState(false);
  const [stagingSelection, setStagingSelection] = useState<StagingActionSelection | null>(null);
  const [openRepositoryOpen, setOpenRepositoryOpen] = useState(false);
  const [reflogOpen, setReflogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const stagingActionHandlersRef = useRef<StagingActionHandlers | null>(null);
  const refsUi = useNarrowRefs();
  const writeBusyRef = useRef(false);

  const tabs = useRepoTabs();
  const activeRepoIdRef = useRef(tabs.activeId);
  activeRepoIdRef.current = tabs.activeId;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const pendingLocateRef = useRef<{ oid: string; repoId: number } | null>(null);

  const resetOverlays = useCallback(() => {
    setFocusTarget(null);
    setRowMenu(null);
    setBranchMenu(null);
    setTagMenu(null);
    setBranchCompareOpen(false);
    setDescriptionBranch(null);
    setDescriptionTag(null);
    setOpenRepositoryOpen(false);
    setReflogOpen(false);
    setCommandPaletteOpen(false);
    setStagingSelection(null);
  }, []);

  // 打开或激活成功后：新标签归零视图态，已有标签恢复历史视图态。
  const handleOpened = useCallback(
    (result: RepoOpenResult) => {
      tabState.switchTo(result.repoId, !result.wasOpen);
      resetOverlays();
    },
    [tabState.switchTo, resetOverlays],
  );

  const session = useRepositorySession({
    scope,
    activeRepoId: tabs.activeId,
    openTab: tabs.open,
    onOpened: handleOpened,
    onBackgroundChange: tabs.markDirty,
    writeBusyRef,
  });
  const { repo, info, settings, busy, graph } = session;
  const { setError, setDiagnostic, setToast } = session;
  const zoom = useFontScale({ settings, setSettings: session.setSettings, onError: setError });
  const language = useAppLanguage(settings, session.setSettings, setError);

  const panes = usePaneWidths();
  const updateState = useUpdateCheck();
  const write = useWriteFlow({
    repo,
    info,
    appBusy: busy,
    reload: graph.reload,
    readSnapshot: session.readSnapshot,
    applySnapshot: session.applySnapshot,
    setError,
    setDiagnostic,
    setToast,
  });
  writeBusyRef.current = write.busy || stagingBusy;
  useEffect(() => {
    setStagingBusy(false);
  }, [repo?.path]);
  const remoteClearRef = useRef<() => void>(() => undefined);

  useStartupRestore({
    info,
    settings,
    open: session.open,
    restore: tabs.restore,
    switchTo: tabState.switchTo,
    applyActiveState: session.applyActiveState,
    reloadSettings: session.reloadSettings,
    resetOverlays,
    setToast,
    setError,
  });

  const settingsEntry = useSettingsEntry({ onOpenRepository: () => void session.pick() });

  const generation = repo?.generation ?? 0;
  const slots = useCompareSlots(repo, tabs.activeId);
  const compare = useCompareResult(slots.base, slots.compare, generation, pathFilter, twoDot);
  const compareWithHead = useCallback(
    (branch: RefDto) => {
      if (repo?.head.oid && !slots.base) {
        slots.setSide("base", {
          oid: repo.head.oid,
          label: repo.head.kind === "branch" ? repo.head.branch ?? "HEAD" : "detached HEAD",
        });
      }
      slots.setSide("compare", branchSlot(branch));
    },
    [repo, slots.base, slots.setSide],
  );
  const search = useSearch(generation, scope);
  // 搜索候选只从已加载的图谱页提取，避免为候选额外查询历史。
  const searchCommits = useMemo(
    () => graph.view.rows.flatMap((row) => (row.commit ? [row.commit] : [])),
    [graph.view],
  );
  // 关闭搜索只退回图谱：关键词与结果保留，直到显式「清空」或切换仓库/范围。
  const closeSearch = useCallback(() => {
    setMode("graph");
  }, []);
  const selectLocatedOid = useCallback((oid: string, repoId: number) => {
    if (activeRepoIdRef.current !== repoId) {
      return;
    }
    setSelectedOid(oid);
    focusSeq.current += 1;
    setFocusTarget({ oid, seq: focusSeq.current });
  }, []);

  // 搜索定位先沿用当前范围；恢复通知指向的新 HEAD 可能在其他分支，失败时切全量重试。
  const locateFromSearch = useCallback(
    (oid: string) => {
      const repoId = tabs.activeId;
      if (repoId === null) {
        return;
      }
      closeSearch();
      void graph.jumpTo(oid).then((ok) => {
        if (activeRepoIdRef.current !== repoId) {
          return;
        }
        if (ok) {
          selectLocatedOid(oid, repoId);
          return;
        }
        if (scopeRef.current.kind !== "all") {
          pendingLocateRef.current = { oid, repoId };
          setScope({ kind: "all" });
        }
      });
    },
    [closeSearch, graph.jumpTo, selectLocatedOid, setScope, tabs.activeId],
  );

  useEffect(() => {
    pendingLocateRef.current = null;
  }, [tabs.activeId]);

  useEffect(() => {
    const pending = pendingLocateRef.current;
    if (!pending || scope.kind !== "all" || activeRepoIdRef.current !== pending.repoId) {
      return;
    }
    pendingLocateRef.current = null;
    void graph.jumpTo(pending.oid).then((ok) => {
      if (ok) {
        selectLocatedOid(pending.oid, pending.repoId);
      }
    });
  }, [graph.jumpTo, scope.kind, selectLocatedOid, tabs.activeId]);
  const tools = settings?.external_tools ?? [];
  // 侧栏/右键菜单的只读导航：单击定位提交、过滤图谱与复制 OID，不进入写流程。
  const refNav = useRefNavigation({
    scope, graph, setScope, setMode, setSelectedOid, setFocusTarget, setToast,
  });

  // 标签切换/关闭与每标签终端常驻（ADR-0032），细节见 useTabController。
  const tabCtrl = useTabController({
    tabs,
    tabState,
    panel,
    forgetCompareTab: slots.forgetTab,
    resetOverlays,
    applyActiveState: session.applyActiveState,
    reloadSettings: session.reloadSettings,
    setError,
    setToast,
    terminalEndedMessage: t("shell.terminalProcessEnded"),
  });

  // 切回标签后若选中提交已不在新页（被改写/丢弃），清空选中而不是留着指向不存在的行。
  const clearMissingSelection = useCallback(() => setSelectedOid(null), [setSelectedOid]);
  useTabSelectionGuard(
    graph,
    repo?.path ?? null,
    tabState.pendingSelection,
    clearMissingSelection,
    tabState.consumeSelection,
  );

  useEffect(() => {
    if (info) initPlatform(info.platform);
  }, [info]);

  // 更新检查在启动数据（appInfo）落地后立刻发起：它只依赖版本号，不必等仓库恢复，
  // 也不该排在首屏之后——用户要求进入软件就先知道有没有新版本。会话内只发一次。
  const updateChecked = useRef(false);
  useEffect(() => {
    if (!info || updateChecked.current) {
      return;
    }
    updateChecked.current = true;
    void runUpdateCheck();
  }, [info]);

  // 两个槽位齐全时自动进入对比视图；用户点“查看图谱”后保持图谱，直到再次选择。
  useEffect(() => {
    if (slots.compare && slots.base) {
      setMode("compare");
    }
  }, [slots.base?.oid, slots.compare?.oid]);

  const launchExternal = useCallback(
    async (
      toolIndex: number,
      left: string | null,
      right: string,
      path: string,
      threeDot: boolean,
    ) => {
      setError(null);
      try {
        await ipc.launchExternalDiff(toolIndex, left, right, path, threeDot);
        const name = settings?.external_tools[toolIndex]?.name ?? t("shell.externalToolFallback");
        setToast(t("shell.externalDiffLaunched", { name }));
      } catch (err) {
        setError(errorText(err));
      }
    },
    [settings, setError, setToast, t],
  );

  const launchDirectoryDiff = useDirectoryDiff(slots.base, slots.compare, tools, setError, setToast);

  const copyDescription = useCallback(
    async (oid: string) => {
      try {
        const detail = await ipc.readCommit(oid);
        await copyText(detail.message.trimEnd());
      } catch (err) {
        setError(errorText(err));
      }
    },
    [setError],
  );

  // 全局 Esc 分层退出（放大 diff 已消费的按键让路），细节见 useGlobalEsc。
  useGlobalEsc({ closeSearch, mode, slots, setMode });

  // 描述编辑只依赖 Git CLI；不受中断态、bare 工作区写限制影响。
  const descriptionDisabled = busy || write.busy || !repo || !info?.git_version_supported;

  // 暂存区、分支/标签/stash 等写操作成功后刷新仓库快照与图谱。
  const stagingMutated = useCallback(
    async (message: string) => {
      const repoPath = repo?.path;
      setToast(message);
      setError(null);
      setDiagnostic(null);
      remoteClearRef.current();
      try {
        const [state, status] = await session.readSnapshot();
        if (!repoPath || state.path === repoPath) {
          session.applySnapshot(state, status);
          await graph.reload({ keepRows: true });
        }
      } catch (err) {
        setError(errorText(err));
      }
    },
    // 快照函数来自 session 且引用稳定，只在仓库路径或 reload 变化时重建。
    [repo?.path, session.readSnapshot, session.applySnapshot, graph.reload, setToast, setError, setDiagnostic],
  );

  const descriptionSaved = useCallback(
    async (message: string) => {
      setDescriptionBranch(null);
      setDescriptionTag(null);
      await stagingMutated(message);
    },
    [stagingMutated],
  );

  // 可导航引用：本地分支、远程分支与标签（HEAD/other 不参与侧栏、过滤与对比）。
  const refs = repo ? repo.refs.filter((ref) => ref.kind !== "head" && ref.kind !== "other") : [];
  const refActions = useRefActions({ repo, writeDisabled: write.disabled, onMutated: stagingMutated });
  const stash = useStashActions({ writeDisabled: write.disabled, onMutated: stagingMutated });
  const remote = useRemoteActions({ repo, writeDisabled: write.disabled, onMutated: stagingMutated });
  remoteClearRef.current = remote.clearError;

  const actions = useAppActionCatalog({
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
    navigateRef: refNav.navigate,
    filterRef: refNav.filter,
    copyDescription,
    compareWithHead,
    setOpenRepositoryOpen,
    setReflogOpen,
    setBranchCompareOpen,
  });
  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  useCommandPaletteShortcut(openCommandPalette);

  // 全局快捷键：终端/缩放（可改键）、搜索、刷新与视图切换，细节见 useGlobalShortcuts。
  useGlobalShortcuts({
    repoOpen: Boolean(repo),
    panel,
    zoom,
    refresh: session.refresh,
    clearRemoteError: remote.clearError,
    setMode,
  });
  // 右键菜单条目组装（提交行/分支/标签共享写与对比动作），细节见 useCommitMenus。
  const commitMenus = useCommitMenus({
    rowMenu,
    branchMenu,
    tagMenu,
    repo,
    writeDisabled: write.disabled,
    descriptionDisabled,
    execute: actions.execute,
    ...write.menuWriteActions,
    onDeleteTag: (name) => refActions.openDeleteTag(name),
    onEditDescription: (shortName) => {
      setError(null);
      setDiagnostic(null);
      setDescriptionBranch(shortName);
    },
    onEditTagDescription: (tag) => {
      setError(null);
      setDiagnostic(null);
      setDescriptionTag(tag);
    },
    ...refActions.menuActions,
  });

  const headLabel = formatHeadLabel(repo, t("shell.headBranchFallback"), t("shell.unbornBranch"));

  return (
    <AppShell
      session={session}
      tabs={tabs}
      tabCtrl={tabCtrl}
      tabState={tabState}
      slots={slots}
      compare={compare}
      search={search}
      searchCommits={searchCommits}
      graph={graph}
      panel={panel}
      remote={remote}
      stash={stash}
      write={write}
      refActions={refActions}
      commitMenus={commitMenus}
      panes={panes}
      settingsEntry={settingsEntry}
      zoom={zoom}
      language={language}
      updateState={updateState}
      refs={refs}
      tools={tools}
      headLabel={headLabel}
      selectedOid={selectedOid}
      focusTarget={focusTarget}
      pathFilter={pathFilter}
      twoDot={twoDot}
      rowMenu={rowMenu}
      branchMenu={branchMenu}
      tagMenu={tagMenu}
      branchCompareOpen={branchCompareOpen}
      descriptionBranch={descriptionBranch}
      descriptionTag={descriptionTag}
      launchExternal={launchExternal}
      launchDirectoryDiff={launchDirectoryDiff}
      stagingMutated={stagingMutated}
      locateFromSearch={locateFromSearch}
      closeSearch={closeSearch}
      onCopyOid={(oid) => void refNav.copyOid(oid)}
      onOpenUpdate={() => void openReleasePage()}
      onCloseBranchCompare={() => setBranchCompareOpen(false)}
      onConfirmBranchCompare={(base, compare) => {
        slots.setSide("base", branchSlot(base));
        slots.setSide("compare", branchSlot(compare));
        setBranchCompareOpen(false);
      }}
      onBranchMenu={(event, branch) => {
        setBranchMenu({ x: event.clientX, y: event.clientY, branch });
      }}
      onTagMenu={(event, tag) => setTagMenu({ x: event.clientX, y: event.clientY, tag })}
      onCloseRowMenu={() => setRowMenu(null)}
      onCloseBranchMenu={() => setBranchMenu(null)}
      onCloseTagMenu={() => setTagMenu(null)}
      onCloseDescriptionBranch={() => setDescriptionBranch(null)}
      onCloseDescriptionTag={() => setDescriptionTag(null)}
      onDescriptionSaved={(message) => void descriptionSaved(message)}
      onFocusTarget={setFocusTarget}
      onRowMenu={setRowMenu}
      onStagingBusy={setStagingBusy}
      refsUi={refsUi}
      stagingBusy={stagingBusy}
      stagingActionHandlersRef={stagingActionHandlersRef}
      setStagingSelection={setStagingSelection}
      openRepositoryOpen={openRepositoryOpen}
      setOpenRepositoryOpen={setOpenRepositoryOpen}
      reflogOpen={reflogOpen}
      setReflogOpen={setReflogOpen}
      commandPaletteOpen={commandPaletteOpen}
      setCommandPaletteOpen={setCommandPaletteOpen}
      actions={actions}
    />
  );
}
