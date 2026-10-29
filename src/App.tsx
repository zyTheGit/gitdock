import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Banners } from "./app/Banners";
import { RepositorySidebar } from "./app/RepositorySidebar";
import { StatusBar } from "./app/StatusBar";
import { WorkspaceBadge } from "./app/WorkspaceBadge";
import { DETAIL_WIDTH, SIDEBAR_WIDTH, usePaneWidths } from "./app/usePaneWidths";
import { useRepositorySession } from "./app/useRepositorySession";
import { useWriteFlow } from "./app/useWriteFlow";
import { BranchCompareDialog } from "./features/compare/BranchCompareDialog";
import { CompareBar } from "./features/compare/CompareBar";
import { CompareView } from "./features/compare/CompareView";
import { commitSlot, useCompareResult, useCompareSlots } from "./features/compare/useCompare";
import { CommitDetailPane } from "./features/detail/CommitDetailPane";
import { GraphPane } from "./features/graph/GraphPane";
import { commitMenuItems, rowMenuItems, type CommitMenuActions } from "./features/graph/menus";
import { branchMenuItems, branchSlot } from "./features/repository/branchMenus";
import { RepositorySwitcher } from "./features/repository/RepositorySwitcher";
import { SearchView } from "./features/search/SearchView";
import { useSearch } from "./features/search/useSearch";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { BranchDescriptionDialog } from "./features/write/BranchDescriptionDialog";
import { ConfirmWriteDialog } from "./features/write/ConfirmWriteDialog";
import { ContextMenu } from "./shared/ContextMenu";
import { PaneSplitter } from "./shared/PaneSplitter";
import { copyText } from "./shared/clipboard";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import type { CommitSummaryDto, GraphScope, RefDto } from "./shared/types";

type ViewMode = "graph" | "compare" | "search";

export default function App() {
  const [scope, setScope] = useState<GraphScope>({ kind: "head" });
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  // 搜索定位请求：seq 递增，保证同一提交再次定位时也会重新滚动一次。
  const focusSeq = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ oid: string; seq: number } | null>(null);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [pathFilter, setPathFilter] = useState("");
  const [twoDot, setTwoDot] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [branchCompareOpen, setBranchCompareOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    commit: CommitSummaryDto;
  } | null>(null);
  const [branchMenu, setBranchMenu] = useState<{
    x: number;
    y: number;
    branch: RefDto;
  } | null>(null);
  const [descriptionBranch, setDescriptionBranch] = useState<string | null>(null);
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

  const panes = usePaneWidths();
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
  writeBusyRef.current = write.busy;

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
        const name = settings?.external_tools[toolIndex]?.name ?? "外部工具";
        setToast(`已调用 ${name} 打开对比文件`);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [settings, setError, setToast],
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

  // Esc：优先取消待替换选择，其次退出搜索/对比，最后清空双槽。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (slots.pending) {
        slots.resolvePending(null);
        return;
      }
      if (mode === "search") {
        closeSearch();
        return;
      }
      if (mode === "compare") {
        setMode("graph");
        return;
      }
      if (slots.base || slots.compare) {
        slots.clearAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, mode, slots]);

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

  const commitActions: CommitMenuActions = {
    writeDisabled: write.disabled,
    onCopyHash: (oid) => void copyText(oid),
    onCopyMessage: (oid) => void copyDescription(oid),
    onCherryPick: (commit) => void write.start("cherry_pick", { commit }),
    onRevert: (commit) => void write.start("revert", { commit }),
  };

  const activeRowMenuItems = rowMenu
    ? rowMenuItems(rowMenu.commit, {
        ...commitActions,
        onSetBase: (commit) => slots.setSide("base", commitSlot(commit)),
        onSetCompare: (commit) => slots.setSide("compare", commitSlot(commit)),
        onOpenDetail: (commit) => {
          setSelectedOid(commit.oid);
          setMode("graph");
        },
      })
    : [];

  const localBranches = repo
    ? repo.refs.filter((ref) => ref.kind === "local_branch")
    : [];

  const compareWithHead = (branch: RefDto) => {
    if (repo?.head.oid && !slots.base) {
      slots.setSide("base", {
        oid: repo.head.oid,
        label: repo.head.kind === "branch" ? repo.head.branch ?? "HEAD" : "detached HEAD",
      });
    }
    slots.setSide("compare", branchSlot(branch));
  };

  const activeBranchMenuItems = branchMenu
    ? branchMenuItems(branchMenu.branch, {
        descriptionDisabled,
        hasHead: Boolean(repo?.head.oid),
        onEditDescription: (shortName) => {
          setError(null);
          setDiagnostic(null);
          setDescriptionBranch(shortName);
        },
        onCompareWithHead: compareWithHead,
        onSetBase: (branch) => slots.setSide("base", branchSlot(branch)),
        onSetCompare: (branch) => slots.setSide("compare", branchSlot(branch)),
      })
    : [];

  const headLabel = repo
    ? repo.head.kind === "branch"
      ? repo.head.branch ?? "分支"
      : repo.head.kind === "detached"
        ? "detached HEAD"
        : "未出生分支"
    : "";

  const compareReady = Boolean(slots.base && slots.compare);

  return (
    <div className="app">
      <header className="topbar">
        <RepositorySwitcher
          currentPath={repo?.path ?? null}
          recent={settings?.recent_repositories ?? []}
          busy={busy}
          onOpen={(path) => void session.open(path)}
          onForget={(path) => void session.forget(path)}
          onPick={() => void session.pick()}
        />
        {repo && workspace && <WorkspaceBadge workspace={workspace} />}
        <div className="topbar-actions">
          {repo && (
            <>
              <button
                className={mode === "search" ? "active" : ""}
                onClick={() => (mode === "search" ? closeSearch() : setMode("search"))}
              >
                搜索
              </button>
              <button
                className={mode === "compare" ? "active" : ""}
                onClick={() => {
                  if (compareReady) {
                    setMode("compare");
                  } else {
                    setBranchCompareOpen(true);
                  }
                }}
                disabled={!compareReady && localBranches.length < 2}
                title={
                  compareReady
                    ? "查看对比结果"
                    : "选择两个分支对比，或用 Ctrl+点击提交选择 Base / Compare"
                }
              >
                对比
              </button>
            </>
          )}
          <button onClick={() => setSettingsOpen(true)}>设置</button>
          <button onClick={() => void session.refresh()} disabled={busy || !repo}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

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
          label="调整左侧栏宽度"
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
                        label="调整详情面板宽度"
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
              <h1>打开一个本地 Git 仓库</h1>
              <p>支持普通仓库、linked worktree 与 bare 仓库（只读）。MVP 单窗口单仓库。</p>
              <button className="primary large" onClick={() => void session.pick()} disabled={busy}>
                选择仓库目录
              </button>
            </section>
          )}
        </main>
      </div>

      <StatusBar busy={busy} repo={repo} info={info} settings={settings} />

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
          gate={write.prompt.gate}
          gateError={write.prompt.gateError}
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
          onClose={() => setSettingsOpen(false)}
          onSaved={setSettings}
          onError={setError}
        />
      )}
    </div>
  );
}
