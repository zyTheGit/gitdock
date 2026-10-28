import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CompareBar } from "./features/compare/CompareBar";
import { CompareView } from "./features/compare/CompareView";
import { commitSlot, useCompareResult, useCompareSlots } from "./features/compare/useCompare";
import { CommitDetailPane } from "./features/detail/CommitDetailPane";
import { GraphPane } from "./features/graph/GraphPane";
import { useGraph } from "./features/graph/useGraph";
import { SearchView } from "./features/search/SearchView";
import { useSearch } from "./features/search/useSearch";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { ContextMenu, type MenuItem } from "./shared/ContextMenu";
import { copyText } from "./shared/clipboard";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import type {
  AppInfoDto,
  CommitSummaryDto,
  GraphScope,
  RepoStateDto,
  SettingsDto,
} from "./shared/types";

type ViewMode = "graph" | "compare" | "search";

export default function App() {
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [repo, setRepo] = useState<RepoStateDto | null>(null);
  const [scope, setScope] = useState<GraphScope>({ kind: "head" });
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [pathFilter, setPathFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    commit: CommitSummaryDto;
  } | null>(null);
  const restored = useRef(false);

  const generation = repo?.generation ?? 0;
  const graph = useGraph(repo?.path ?? null, scope);
  const slots = useCompareSlots(repo);
  const compare = useCompareResult(slots.base, slots.compare, generation, pathFilter);
  const search = useSearch(generation, scope);
  const tools = settings?.external_tools ?? [];

  // 两个槽位齐全时自动进入对比视图；用户点“查看图谱”后保持图谱，直到再次选择。
  useEffect(() => {
    if (slots.compare && slots.base) {
      setMode("compare");
    }
  }, [slots.base?.oid, slots.compare?.oid]);

  const openRepository = useCallback(async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const state = await ipc.openRepository(path);
      setScope({ kind: "head" });
      setSelectedOid(null);
      setPathFilter("");
      setMode("graph");
      setRowMenu(null);
      setRepo(state);
      setSettings(await ipc.rememberRepository(state.path));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [appInfo, loaded] = await Promise.all([ipc.appInfo(), ipc.loadSettings()]);
        setInfo(appInfo);
        setSettings(loaded);
        if (!restored.current && loaded.restore_last_repository) {
          restored.current = true;
          const last = loaded.recent_repositories[0];
          if (last) {
            await openRepository(last.path);
          }
        }
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, [openRepository]);

  const pickRepository = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "选择 Git 仓库" });
      if (typeof selected === "string") {
        await openRepository(selected);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, [openRepository]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRepo(await ipc.repositoryState());
      await graph.reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [graph]);

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
      } catch (err) {
        setError(errorText(err));
      }
    },
    [],
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
        setMode("graph");
        search.reset();
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
  }, [mode, search, slots]);

  const rowMenuItems: MenuItem[] = rowMenu
    ? [
        {
          label: "复制完整哈希",
          onSelect: () => void copyText(rowMenu.commit.oid),
        },
        {
          label: "复制提交说明",
          onSelect: () => void copyText(rowMenu.commit.summary),
        },
        {
          label: "设为 Base",
          onSelect: () => slots.setSide("base", commitSlot(rowMenu.commit)),
        },
        {
          label: "设为 Compare",
          onSelect: () => slots.setSide("compare", commitSlot(rowMenu.commit)),
        },
        {
          label: "查看详情",
          onSelect: () => {
            setSelectedOid(rowMenu.commit.oid);
            setMode("graph");
          },
        },
      ]
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
        <div className="brand">
          <span className="brand-mark">⎇</span>
          <span>Git Graph</span>
        </div>
        <div className="topbar-actions">
          {repo && (
            <>
              <button
                className={mode === "search" ? "active" : ""}
                onClick={() => setMode(mode === "search" ? "graph" : "search")}
              >
                搜索
              </button>
              <button
                onClick={() => setMode("compare")}
                disabled={!compareReady}
                title={compareReady ? "查看对比结果" : "先用 Ctrl+点击选择 Base / Compare"}
              >
                对比
              </button>
            </>
          )}
          <button onClick={() => setSettingsOpen(true)}>设置</button>
          <button className="primary" onClick={pickRepository} disabled={busy}>
            打开仓库
          </button>
          <button onClick={refresh} disabled={busy || !repo}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2>最近仓库</h2>
          {settings && settings.recent_repositories.length > 0 ? (
            <ul className="recent">
              {settings.recent_repositories.map((entry) => (
                <li key={entry.path}>
                  <button
                    className={repo?.path === entry.path ? "recent-item active" : "recent-item"}
                    title={entry.path}
                    onClick={() => openRepository(entry.path)}
                    disabled={busy}
                  >
                    {entry.path.split(/[\\/]/).filter(Boolean).pop() ?? entry.path}
                  </button>
                  <span className="recent-path">{entry.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">尚未打开过仓库</p>
          )}
          {repo && (
            <div className="repo-facts">
              <h2>仓库信息</h2>
              <dl>
                <dt>对象格式</dt>
                <dd>{repo.object_format.toUpperCase()}</dd>
                <dt>HEAD</dt>
                <dd>{headLabel}</dd>
                <dt>OID</dt>
                <dd className="mono">{repo.head.oid ?? "—"}</dd>
                <dt>generation</dt>
                <dd className="mono">{repo.generation}</dd>
                <dt>引用</dt>
                <dd>{repo.refs.length} 个</dd>
                {repo.is_bare && <dd className="tag">bare（只读）</dd>}
                {repo.is_linked_worktree && <dd className="tag">linked worktree</dd>}
                {repo.is_shallow && <dd className="tag">shallow</dd>}
              </dl>
            </div>
          )}
        </aside>

        <main className="main">
          {repo?.interruption.kinds.length ? (
            <div className="banner warning">
              <strong>{repo.interruption.message}</strong>
              {repo.interruption.files.length > 0 && (
                <span>未完成文件：{repo.interruption.files.join("、")}</span>
              )}
              {repo.interruption.terminal_hint && <code>{repo.interruption.terminal_hint}</code>}
            </div>
          ) : null}

          {repo?.warnings.map((warning) => (
            <div className="banner info" key={warning.code}>
              {warning.message}
            </div>
          ))}

          {info && !info.git_version_supported && (
            <div className="banner danger">
              系统 Git 版本 {info.git_version ?? "未知"} 低于最低要求 {info.minimum_git_version}，写操作将不可用。
            </div>
          )}

          {error && <div className="banner danger">{error}</div>}

          {repo ? (
            mode === "search" ? (
              <SearchView
                repo={repo}
                scope={scope}
                search={search}
                onOpenCommit={(oid) => {
                  setSelectedOid(oid);
                  setMode("graph");
                }}
                onClose={() => {
                  setMode("graph");
                  search.reset();
                }}
              />
            ) : mode === "compare" && slots.base && slots.compare ? (
              <CompareView
                repoGeneration={repo.generation}
                base={slots.base}
                compare={slots.compare}
                loader={compare}
                pathFilter={pathFilter}
                onPathFilterChange={setPathFilter}
                tools={tools}
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
                      true,
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
                    }}
                    graph={graph}
                    selectedOid={selectedOid}
                    onSelect={setSelectedOid}
                    onCtrlSelect={slots.ctrlSelect}
                    onContextMenu={(event: MouseEvent, commit: CommitSummaryDto) => {
                      setRowMenu({ x: event.clientX, y: event.clientY, commit });
                    }}
                  />
                  {selectedOid && (
                    <CommitDetailPane
                      repo={repo}
                      oid={selectedOid}
                      tools={tools}
                      onClose={() => setSelectedOid(null)}
                      onExternalDiff={(toolIndex, path, left) =>
                        void launchExternal(toolIndex, left, selectedOid, path, false)
                      }
                    />
                  )}
                </div>
              </>
            )
          ) : (
            <section className="welcome">
              <h1>打开一个本地 Git 仓库</h1>
              <p>支持普通仓库、linked worktree 与 bare 仓库（只读）。MVP 单窗口单仓库。</p>
              <button className="primary large" onClick={pickRepository} disabled={busy}>
                选择仓库目录
              </button>
            </section>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>{busy ? "处理中…" : repo ? "就绪" : "未打开仓库"}</span>
        <span className="mono">
          {info ? `git ${info.git_version ?? "未知"} · ${info.platform}` : ""}
        </span>
      </footer>

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenuItems}
          onClose={() => setRowMenu(null)}
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
