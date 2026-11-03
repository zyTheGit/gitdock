import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Banners } from "./app/Banners";
import { RepositorySidebar } from "./app/RepositorySidebar";
import { StatusBar } from "./app/StatusBar";
import { TopBar } from "./app/TopBar";
import { useCommitMenus, type BranchMenuState, type RowMenuState } from "./app/useCommitMenus";
import { useGlobalEsc, type ViewMode } from "./app/useGlobalEsc";
import { DETAIL_WIDTH, SIDEBAR_WIDTH, usePaneWidths } from "./app/usePaneWidths";
import { useFontScale } from "./app/useFontScale";
import { useAppLanguage } from "./i18n/useAppLanguage";
import { toLanguagePreference, useI18n } from "./i18n";

import { useRepositorySession } from "./app/useRepositorySession";
import {
  clearSkippedUpdate,
  openAvailableUpdate,
  pendingUpdate,
  runUpdateCheck,
  skipAvailableUpdate,
  useUpdateCheck,
} from "./app/useUpdateCheck";
import { useWriteFlow } from "./app/useWriteFlow";
import { BranchCompareDialog } from "./features/compare/BranchCompareDialog";
import { CompareBar } from "./features/compare/CompareBar";
import { CompareView } from "./features/compare/CompareView";
import { useCompareResult, useCompareSlots } from "./features/compare/useCompare";
import { CommitDetailPane } from "./features/detail/CommitDetailPane";
import { GraphPane } from "./features/graph/GraphPane";
import { commitMenuItems } from "./features/graph/menus";
import { branchSlot } from "./features/repository/branchMenus";

import { SearchView } from "./features/search/SearchView";
import { useSearch } from "./features/search/useSearch";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { StagingView } from "./features/staging/StagingView";
import { TerminalPanel } from "./features/terminal/TerminalPanel";
import { BranchDescriptionDialog } from "./features/write/BranchDescriptionDialog";
import { ConfirmWriteDialog } from "./features/write/ConfirmWriteDialog";
import { ContextMenu } from "./shared/ContextMenu";

import { PaneSplitter } from "./shared/PaneSplitter";
import { useBindings, useKeybindings } from "./shared/keybindings";
import { copyText } from "./shared/clipboard";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import type { CommitSummaryDto, GraphScope } from "./shared/types";

export default function App() {
  const { t } = useI18n();
  const [scope, setScope] = useState<GraphScope>({ kind: "head" });
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  // 搜索定位请求：seq 递增，保证同一提交再次定位时也会重新滚动一次。
  const focusSeq = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ oid: string; seq: number } | null>(null);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [pathFilter, setPathFilter] = useState("");
  const [twoDot, setTwoDot] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [branchCompareOpen, setBranchCompareOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [descriptionBranch, setDescriptionBranch] = useState<string | null>(null);
  const [stagingBusy, setStagingBusy] = useState(false);
  const writeBusyRef = useRef(false);

  const resetView = useCallback(() => {
    setScope({ kind: "head" });
    setSelectedOid(null);
    setFocusTarget(null);
    setPathFilter("");
    setTwoDot(false);
    setMode("graph");
    setRowMenu(null);
    setBranchMenu(null);
    setDescriptionBranch(null);
  }, []);

  const session = useRepositorySession({ scope, onOpened: resetView, writeBusyRef });
  const { repo, info, settings, workspace, busy, error, diagnostic, toast, graph } = session;
  const { setSettings, setError, setDiagnostic, setToast } = session;
  const zoom = useFontScale({ settings, setSettings, onError: setError });
  const language = useAppLanguage(settings, setSettings, setError);

  const panes = usePaneWidths();
  const updateState = useUpdateCheck();
  const updateVersion = pendingUpdate(updateState)?.latest_version ?? null;
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

  const handleTerminalRunning = useCallback((running: boolean) => {
    setTerminalRunning(running);
  }, []);

  const toggleTerminal = useCallback(() => {
    setTerminalMounted(true);
    setTerminalOpen((open) => !open);
  }, []);

  // 下载页地址由后端返回并经 Rust 打开，前端不拼 URL、不用 window.open。
  const openUpdatePage = useCallback(() => {
    void openAvailableUpdate();
  }, []);

  // 切仓库时 Rust 已结束旧会话；收起面板并提示，避免误以为旧终端仍在。
  const handleTerminalRepoChanged = useCallback(() => {
    setTerminalOpen(false);
    setToast(t("shell.terminalProcessEnded"));
  }, [setToast, t]);

  const generation = repo?.generation ?? 0;
  const slots = useCompareSlots(repo);
  const compare = useCompareResult(slots.base, slots.compare, generation, pathFilter, twoDot);
  const search = useSearch(generation, scope);
  // 搜索候选只从已加载的图谱页提取，避免为候选额外查询历史。
  const searchCommits = useMemo(
    () => graph.view.rows.flatMap((row) => (row.commit ? [row.commit] : [])),
    [graph.view],
  );
  // 关闭搜索框即丢弃本次搜索与输入，下次打开从空白开始。
  const closeSearch = useCallback(() => {
    setMode("graph");
    search.reset();
  }, [search.reset]);
  // 搜索结果直接在主图谱定位：关闭弹框、载入目标页，成功后再选中并居中。
  // 等目标页落地才发出滚动请求，避免对旧页的行先滚一次。
  const locateFromSearch = useCallback(
    (oid: string) => {
      closeSearch();
      void graph.jumpTo(oid).then((ok) => {
        if (!ok) {
          return;
        }
        setSelectedOid(oid);
        focusSeq.current += 1;
        setFocusTarget({ oid, seq: focusSeq.current });
      });
    },
    [closeSearch, graph.jumpTo],
  );
  const tools = settings?.external_tools ?? [];

  // 更新检查要等启动数据（appInfo + settings）落地、且首次仓库加载收尾后再补发一次：
  // 它是一次外网请求，既不能推迟 uiReady 开窗，也不该与恢复仓库抢 IPC。
  // 24 小时节流由 useUpdateCheck 内部负责，这里只保证一个会话内只发起一次。
  const updateChecked = useRef(false);
  useEffect(() => {
    if (!info || !settings || busy || updateChecked.current) {
      return;
    }
    updateChecked.current = true;
    void runUpdateCheck();
  }, [info, settings, busy]);

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

  // 全局快捷键：终端开合与界面缩放，键位可在设置「快捷键」分区改。
  // 在捕获阶段派发，终端里的按键也由窗口层接管，避免误发给 Shell。
  const bindings = useBindings();
  useKeybindings({
    "terminal.toggle": repo ? toggleTerminal : undefined,
    "zoom.in": zoom.zoomIn,
    "zoom.out": zoom.zoomOut,
    "zoom.reset": zoom.resetZoom,
  });

  // 描述编辑只依赖 Git CLI；不受中断态、bare 工作区写限制影响。
  const descriptionDisabled = busy || write.busy || !repo || !info?.git_version_supported;

  const descriptionSaved = useCallback(
    async (message: string) => {
      const repoPath = repo?.path;
      setDescriptionBranch(null);
      setToast(message);
      setError(null);
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
    [repo?.path, session.readSnapshot, session.applySnapshot, graph.reload, setToast, setError],
  );

  // 暂存区写成功后刷新仓库快照与图谱；暂存列表由 StagingView 自行重载。
  const stagingMutated = useCallback(
    async (message: string) => {
      const repoPath = repo?.path;
      setToast(message);
      setError(null);
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
    [repo?.path, session.readSnapshot, session.applySnapshot, graph.reload, setToast, setError],
  );

  const localBranches = repo
    ? repo.refs.filter((ref) => ref.kind === "local_branch")
    : [];

  // 右键菜单条目组装（提交行/分支共享写与对比动作），细节见 useCommitMenus。
  const { commitActions, activeRowMenuItems, activeBranchMenuItems } = useCommitMenus({
    rowMenu,
    branchMenu,
    repo,
    slots,
    writeDisabled: write.disabled,
    descriptionDisabled,
    onCopyMessage: copyDescription,
    onCherryPick: (commit) => void write.start("cherry_pick", { commit }),
    onRevert: (commit) => void write.start("revert", { commit }),
    onEditDescription: (shortName) => {
      setError(null);
      setDiagnostic(null);
      setDescriptionBranch(shortName);
    },
    onSelectCommit: (oid) => {
      setSelectedOid(oid);
      setMode("graph");
    },
  });

  const headLabel = repo
    ? repo.head.kind === "branch"
      ? repo.head.branch ?? t("shell.headBranchFallback")
      : repo.head.kind === "detached"
        ? "detached HEAD"
        : t("shell.unbornBranch")
    : "";

  const compareReady = Boolean(slots.base && slots.compare);

  return (
    <div className="app">
      <TopBar
        repo={repo}
        workspace={workspace}
        recent={settings?.recent_repositories ?? []}
        busy={busy}
        mode={mode}
        compareReady={compareReady}
        localBranchCount={localBranches.length}
        terminalOpen={terminalOpen}
        terminalRunning={terminalRunning}
        terminalShortcut={bindings["terminal.toggle"]}
        onOpenRepo={(path) => void session.open(path)}
        onForgetRepo={(path) => void session.forget(path)}
        onPickRepo={() => void session.pick()}
        onRefresh={() => void session.refresh()}
        closeSearch={closeSearch}
        setMode={setMode}
        onOpenBranchCompare={() => setBranchCompareOpen(true)}
        onToggleTerminal={toggleTerminal}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="layout">
        <RepositorySidebar
          width={panes.sidebarWidth}
          repo={repo}
          headLabel={headLabel}
          localBranches={localBranches}
          writeDisabled={write.disabled}
          onCompareBranches={() => setBranchCompareOpen(true)}
          onSwitchBranch={(branch) => void write.start("switch_branch", { branch: branch.short_name })}
          onBranchMenu={(event, branch) => {
            setBranchMenu({ x: event.clientX, y: event.clientY, branch });
          }}
        />
        <PaneSplitter
          label={t("shell.sidebarResizeLabel")}
          width={panes.sidebarWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          defaultValue={SIDEBAR_WIDTH.reset}
          onChange={panes.setSidebarWidth}
        />

        <main className="main">
          <Banners
            repo={repo}
            info={info}
            error={error}
            diagnostic={diagnostic}
            interruptionDisabled={write.interruptionDisabled}
            onInterruptionAction={(kind, interruption) =>
              void write.startInterruption(kind, interruption)
            }
            onCopyDiagnostic={() => void copyText(diagnostic ?? "")}
          />

          {repo ? (
            mode === "compare" && slots.base && slots.compare ? (
              <CompareView
                repoGeneration={repo.generation}
                base={slots.base}
                compare={slots.compare}
                loader={compare}
                pathFilter={pathFilter}
                onPathFilterChange={setPathFilter}
                twoDot={twoDot}
                onTwoDotChange={setTwoDot}
                tools={tools}
                defaultTool={settings?.default_tool ?? null}
                commitMenu={(commit) => commitMenuItems(commit, commitActions)}
                onOpenCommit={(oid) => {
                  setSelectedOid(oid);
                  setMode("graph");
                }}
                onExternalDiff={(toolIndex, path) => {
                  if (slots.base && slots.compare) {
                    void launchExternal(
                      toolIndex,
                      slots.base.oid,
                      slots.compare.oid,
                      path,
                      !twoDot,
                    );
                  }
                }}
                onBack={() => setMode("graph")}
              />
            ) : mode === "staging" ? (
              <StagingView
                repo={repo}
                writeDisabled={write.disabled}
                onBusyChange={setStagingBusy}
                onMutated={stagingMutated}
                onOpenTerminal={() => {
                  setTerminalMounted(true);
                  setTerminalOpen(true);
                }}
                onExit={() => setMode("graph")}
              />
            ) : (
              <>
                <CompareBar
                  repo={repo}
                  base={slots.base}
                  compare={slots.compare}
                  pending={slots.pending}
                  invalidRef={compare.invalidRef}
                  onClear={slots.clear}
                  onSwap={slots.swap}
                  onResolvePending={slots.resolvePending}
                />
                <div className={selectedOid ? "workspace detail-open" : "workspace"}>
                  <GraphPane
                    repo={repo}
                    scope={scope}
                    onScopeChange={(next) => {
                      setScope(next);
                      setSelectedOid(null);
                      setFocusTarget(null);
                    }}
                    graph={graph}
                    selectedOid={selectedOid}
                    focusedOid={focusTarget?.oid ?? null}
                    focusSeq={focusTarget?.seq ?? null}
                    onSelect={(oid) => {
                      setSelectedOid(oid);
                      setFocusTarget(null);
                    }}
                    onCtrlSelect={slots.ctrlSelect}
                    onContextMenu={(event: MouseEvent, commit: CommitSummaryDto) => {
                      setRowMenu({ x: event.clientX, y: event.clientY, commit });
                    }}
                  />
                  {selectedOid && (
                    <>
                      <PaneSplitter
                        label={t("shell.detailResizeLabel")}
                        width={panes.detailWidth}
                        min={DETAIL_WIDTH.min}
                        max={panes.detailMax}
                        defaultValue={DETAIL_WIDTH.reset}
                        invert
                        onChange={panes.setDetailWidth}
                      />
                      <CommitDetailPane
                        repo={repo}
                        oid={selectedOid}
                        tools={tools}
                        width={panes.detailWidth}
                        onClose={() => setSelectedOid(null)}
                        onBranchJump={(branch) => {
                          setScope({ kind: "branch", value: branch });
                          setSelectedOid(null);
                          setFocusTarget(null);
                        }}
                        onExternalDiff={(toolIndex, path, left) =>
                          void launchExternal(toolIndex, left, selectedOid, path, false)
                        }
                      />
                    </>
                  )}
                </div>
              </>
            )
          ) : (
            <section className="welcome">
              <h1>{t("shell.welcomeTitle")}</h1>
              <p>{t("shell.welcomeBody")}</p>
              <button className="primary large" onClick={() => void session.pick()} disabled={busy}>
                {t("shell.chooseRepoDirectory")}
              </button>
            </section>
          )}
        </main>
      </div>

      {repo && terminalMounted && (
        <TerminalPanel
          repoPath={repo.path}
          visible={terminalOpen}
          lazygitConfig={settings?.lazygit_path ?? ""}
          terminalShortcut={bindings["terminal.toggle"]}
          onCollapse={() => setTerminalOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onRunningChange={handleTerminalRunning}
          onRepoChanged={handleTerminalRepoChanged}
        />
      )}

      <StatusBar
        busy={busy}
        repo={repo}
        info={info}
        settings={settings}
        fontScale={zoom.fontScale}
        terminalOpen={terminalOpen}
        terminalRunning={terminalRunning}
        terminalShortcut={bindings["terminal.toggle"]}
        updateVersion={updateVersion}
        onToggleTerminal={toggleTerminal}
        onOpenUpdate={openUpdatePage}
      />

      {mode === "search" && repo && (
        <SearchView
          repo={repo}
          search={search}
          commits={searchCommits}
          onLocateCommit={locateFromSearch}
          onClose={closeSearch}
        />
      )}

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={activeRowMenuItems}
          onClose={() => setRowMenu(null)}
        />
      )}

      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          items={activeBranchMenuItems}
          onClose={() => setBranchMenu(null)}
        />
      )}

      {descriptionBranch && (
        <BranchDescriptionDialog
          branch={descriptionBranch}
          onCancel={() => setDescriptionBranch(null)}
          onSaved={(message) => void descriptionSaved(message)}
        />
      )}

      {write.prompt && (
        <ConfirmWriteDialog
          kind={write.prompt.kind}
          commit={write.prompt.commit}
          branch={write.prompt.branch}
          interruption={write.prompt.interruption}
          gate={write.prompt.gate}
          gateError={write.prompt.gateError}
          validating={write.validating}
          mainline={write.mainline}
          onMainlineChange={write.changeMainline}
          busy={write.busy}
          onCancel={write.cancel}
          onConfirm={() => void write.run()}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {branchCompareOpen && repo && localBranches.length >= 2 && (
        <BranchCompareDialog
          branches={localBranches}
          headBranch={repo.head.branch ?? null}
          initialBase={slots.base?.label}
          initialCompare={slots.compare?.label}
          onCancel={() => setBranchCompareOpen(false)}
          onConfirm={(base, compare) => {
            slots.setSide("base", branchSlot(base));
            slots.setSide("compare", branchSlot(compare));
            setBranchCompareOpen(false);
          }}
        />
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          language={toLanguagePreference(settings.language)}
          onLanguageChange={language.changeLanguage}
          info={info}
          fontScale={zoom.fontScale}
          updateCheck={updateState}
          updateOffer={pendingUpdate(updateState)}
          onCheckUpdate={() => runUpdateCheck(true)}
          onOpenDownloadPage={openAvailableUpdate}
          onSkipUpdate={skipAvailableUpdate}
          onClearSkippedUpdate={clearSkippedUpdate}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onResetZoom={zoom.resetZoom}
          onClose={() => setSettingsOpen(false)}
          onSaved={setSettings}
          onError={setError}
        />
      )}
    </div>
  );
}
