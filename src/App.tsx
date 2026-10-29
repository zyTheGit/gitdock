import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BranchCompareDialog } from "./features/compare/BranchCompareDialog";
import { CompareBar } from "./features/compare/CompareBar";
import { CompareView } from "./features/compare/CompareView";
import { commitSlot, useCompareResult, useCompareSlots } from "./features/compare/useCompare";
import { CommitDetailPane } from "./features/detail/CommitDetailPane";
import { GraphPane } from "./features/graph/GraphPane";
import { useGraph } from "./features/graph/useGraph";
import { SearchView } from "./features/search/SearchView";
import { useSearch } from "./features/search/useSearch";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { BranchDescriptionDialog } from "./features/write/BranchDescriptionDialog";
import { ConfirmWriteDialog } from "./features/write/ConfirmWriteDialog";
import { ContextMenu, type MenuItem } from "./shared/ContextMenu";
import { PaneSplitter } from "./shared/PaneSplitter";
import { copyText } from "./shared/clipboard";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import type {
  AppInfoDto,
  CommitSummaryDto,
  GateReportDto,
  GraphScope,
  RefDto,
  RepoStateDto,
  SettingsDto,
  WorkspaceStatusDto,
  WriteKind,
  WriteOutcomeDto,
} from "./shared/types";

type ViewMode = "graph" | "compare" | "search";

const EVENT_REPOSITORY_CHANGED = "repository-changed";

const SIDEBAR_WIDTH = { min: 200, max: 520, reset: 280 } as const;
const DETAIL_WIDTH = { min: 340, max: 960, reset: 620 } as const;
const SIDEBAR_WIDTH_KEY = "git-graph.sidebar-width";
const DETAIL_WIDTH_KEY = "git-graph.detail-width";

function storedPaneWidth(key: string, min: number, max: number, fallback: number): number {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? Math.min(max, Math.max(min, stored)) : fallback;
}

function workspaceLabel(status: WorkspaceStatusDto): string {
  if (status.is_bare) {
    return "bare 仓库";
  }
  if (status.conflicted > 0) {
    return `工作区冲突 · ${status.conflicted} 个文件`;
  }
  if (!status.dirty) {
    return "工作区干净";
  }
  const parts: string[] = [];
  if (status.staged > 0) parts.push(`已暂存 ${status.staged}`);
  if (status.tracked > 0) parts.push(`已修改 ${status.tracked}`);
  if (status.untracked > 0) parts.push(`未跟踪 ${status.untracked}`);
  return `工作区脏 · ${parts.join(" / ")}`;
}

const WRITE_LABEL: Record<WriteKind, string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
  switch_branch: "切换分支",
  set_branch_description: "更新分支描述",
};

function outcomeMessage(kind: WriteKind, outcome: WriteOutcomeDto, branch?: string): string {
  switch (outcome.status) {
    case "succeeded":
      return kind === "switch_branch"
        ? `已切换到分支 ${branch ?? ""}`
        : `${WRITE_LABEL[kind]} 成功，已刷新图谱`;
    case "empty_pick":
      return "无变更（空 pick），已清理本次操作状态";
    case "conflicted":
      return "发生冲突，请在终端处理；本应用不会自动 abort";
    case "rejected":
      return "写前检查未通过，未执行";
    default:
      return `${WRITE_LABEL[kind]} 失败：${outcome.message}`;
  }
}

export default function App() {
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [repo, setRepo] = useState<RepoStateDto | null>(null);
  const [scope, setScope] = useState<GraphScope>({ kind: "head" });
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [pathFilter, setPathFilter] = useState("");
  const [twoDot, setTwoDot] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [branchCompareOpen, setBranchCompareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [writePrompt, setWritePrompt] = useState<{
    kind: Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch">;
    commit?: CommitSummaryDto;
    branch?: string;
    gate: GateReportDto | null;
    gateError?: string;
  } | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceStatusDto | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedPaneWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max, SIDEBAR_WIDTH.reset),
  );
  const [detailWidth, setDetailWidth] = useState(() =>
    storedPaneWidth(DETAIL_WIDTH_KEY, DETAIL_WIDTH.min, DETAIL_WIDTH.max, DETAIL_WIDTH.reset),
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const restored = useRef(false);
  const repoRef = useRef<RepoStateDto | null>(null);
  const busyRef = useRef(false);
  const writeBusyRef = useRef(false);
  repoRef.current = repo;
  busyRef.current = busy;
  writeBusyRef.current = writeBusy;

  const generation = repo?.generation ?? 0;
  const graph = useGraph(repo?.path ?? null, scope);
  const slots = useCompareSlots(repo);
  const compare = useCompareResult(slots.base, slots.compare, generation, pathFilter, twoDot);
  const search = useSearch(generation, scope);
  const tools = settings?.external_tools ?? [];

  // 两个槽位齐全时自动进入对比视图；用户点“查看图谱”后保持图谱，直到再次选择。
  useEffect(() => {
    if (slots.compare && slots.base) {
      setMode("compare");
    }
  }, [slots.base?.oid, slots.compare?.oid]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 详情面板不能挤占图谱；窗口或侧栏变化时重新收紧上限。
  const detailMax = Math.max(
    DETAIL_WIDTH.min,
    Math.min(DETAIL_WIDTH.max, viewportWidth - sidebarWidth - 400),
  );
  useEffect(() => {
    setDetailWidth((current) => Math.min(current, detailMax));
  }, [detailMax]);

  const openRepository = useCallback(async (path: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setWorkspace(null);
    try {
      const state = await ipc.openRepository(path);
      setScope({ kind: "head" });
      setSelectedOid(null);
      setPathFilter("");
      setTwoDot(false);
      setMode("graph");
      setRowMenu(null);
      setBranchMenu(null);
      setDescriptionBranch(null);
      setRepo(state);
      setWorkspace(await ipc.workspaceStatus().catch(() => null));
      setSettings(await ipc.rememberRepository(state.path));
      return true;
    } catch (err) {
      setWorkspace(null);
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [appInfo, loaded, startupPath] = await Promise.all([
          ipc.appInfo(),
          ipc.loadSettings(),
          ipc.startupRepository().catch(() => null),
        ]);
        setInfo(appInfo);
        setSettings(loaded);
        if (restored.current) {
          return;
        }
        restored.current = true;
        // 启动传参优先；打开失败再回退到“恢复上次仓库”。
        const opened = startupPath ? await openRepository(startupPath) : false;
        if (!opened && loaded.restore_last_repository) {
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
      const [state, status] = await Promise.all([
        ipc.repositoryState(),
        ipc.workspaceStatus(),
      ]);
      setRepo(state);
      setWorkspace(status);
      await graph.reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [graph]);

  // 监听只负责标脏：事件到达后防抖刷新，写操作进行中交由写后刷新收尾。
  const autoRefresh = useCallback(async () => {
    const current = repoRef.current;
    if (!current || busyRef.current || writeBusyRef.current) {
      return;
    }
    try {
      const [state, status] = await Promise.all([
        ipc.repositoryState(),
        ipc.workspaceStatus(),
      ]);
      if (!repoRef.current || state.path !== repoRef.current.path) {
        return;
      }
      setRepo(state);
      setWorkspace(status);
      await graph.reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    }
  }, [graph]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    void listen<{ path: string; generation: number }>(EVENT_REPOSITORY_CHANGED, (event) => {
      const current = repoRef.current;
      if (!current || event.payload.path !== current.path) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) {
          void autoRefresh();
        }
      }, 150);
    })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch((err) => setError(`监听仓库变更失败：${errorText(err)}`));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [autoRefresh]);

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
    [settings],
  );

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 写操作分两步：先取 Gate 结论展示在确认框中，Gate 通过后才允许执行。
  const startWrite = useCallback(
    async (
      kind: Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch">,
      target: { commit?: CommitSummaryDto; branch?: string },
    ) => {
      setRowMenu(null);
      setError(null);
      setDiagnostic(null);
      setWritePrompt({ kind, ...target, gate: null });
      const stillCurrent = (current: typeof writePrompt) =>
        Boolean(current) &&
        current!.kind === kind &&
        current!.commit?.oid === target.commit?.oid &&
        current!.branch === target.branch;
      try {
        const gate = await ipc.validateWrite({
          kind,
          oid: target.commit?.oid,
          branch: target.branch,
        });
        setWritePrompt((current) => (stillCurrent(current) ? { ...current!, gate } : current));
      } catch (err) {
        setWritePrompt((current) =>
          stillCurrent(current) ? { ...current!, gateError: errorText(err) } : current,
        );
      }
    },
    [],
  );

  const runWrite = useCallback(async () => {
    if (!writePrompt?.gate?.ok) {
      return;
    }
    const { kind, commit, branch } = writePrompt;
    const repoPath = repo?.path;
    setWriteBusy(true);
    setError(null);
    setDiagnostic(null);
    try {
      const outcome = await ipc.executeWrite({ kind, oid: commit?.oid, branch });
      setWritePrompt(null);
      setToast(outcomeMessage(kind, outcome, branch));
      if (outcome.status === "failed") {
        setError(outcome.message);
        setDiagnostic(outcome.stderr ?? outcome.message);
      }
      if (outcome.status !== "rejected") {
        const [state, status] = await Promise.all([
          ipc.repositoryState(),
          ipc.workspaceStatus(),
        ]);
        // generation 是 refs/HEAD 指纹（随机 64 位），不具备单调性，不能做大小比较；
        // 写后状态是重新探测的，只需确认仓库未被切换，避免旧仓库结果覆盖新界面。
        if (!repoPath || state.path === repoPath) {
          setRepo(state);
          setWorkspace(status);
          await graph.reload({ keepRows: true });
        }
      }
    } catch (err) {
      setWritePrompt(null);
      setError(errorText(err));
    } finally {
      setWriteBusy(false);
    }
  }, [graph, repo?.path, writePrompt]);

  const descriptionSaved = useCallback(
    async (message: string) => {
      const repoPath = repo?.path;
      setDescriptionBranch(null);
      setToast(message);
      setError(null);
      try {
        const [state, status] = await Promise.all([
          ipc.repositoryState(),
          ipc.workspaceStatus(),
        ]);
        if (!repoPath || state.path === repoPath) {
          setRepo(state);
          setWorkspace(status);
          await graph.reload({ keepRows: true });
        }
      } catch (err) {
        setError(errorText(err));
      }
    },
    [graph, repo?.path],
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

  const writeDisabled =
    busy ||
    writeBusy ||
    !repo ||
    repo.is_bare ||
    repo.interruption.kinds.length > 0 ||
    !info?.git_version_supported;

  const copyDescription = useCallback(async (oid: string) => {
    try {
      const detail = await ipc.readCommit(oid);
      await copyText(detail.message.trimEnd());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  const commitMenuItems = useCallback(
    (commit: CommitSummaryDto): MenuItem[] => [
      { label: "复制完整哈希", onSelect: () => void copyText(commit.oid) },
      { label: "复制提交说明", onSelect: () => void copyDescription(commit.oid) },
      {
        label: "Cherry Pick 此提交",
        disabled: writeDisabled,
        onSelect: () => void startWrite("cherry_pick", { commit }),
      },
      {
        label: "Revert 此提交",
        disabled: writeDisabled,
        onSelect: () => void startWrite("revert", { commit }),
      },
    ],
    [copyDescription, startWrite, writeDisabled],
  );

  const rowMenuItems: MenuItem[] = rowMenu
    ? [
        ...commitMenuItems(rowMenu.commit),
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

  const localBranches = repo
    ? repo.refs.filter((ref) => ref.kind === "local_branch")
    : [];

  // 描述编辑只依赖 Git CLI；不受中断态、bare 工作区写限制影响。
  const descriptionDisabled = busy || writeBusy || !repo || !info?.git_version_supported;

  const branchSlot = (branch: RefDto) => ({
    oid: branch.commit_oid ?? branch.target_oid,
    label: branch.short_name,
  });

  const compareWithHead = (branch: RefDto) => {
    if (repo?.head.oid && !slots.base) {
      slots.setSide("base", {
        oid: repo.head.oid,
        label: repo.head.kind === "branch" ? repo.head.branch ?? "HEAD" : "detached HEAD",
      });
    }
    slots.setSide("compare", branchSlot(branch));
  };

  const branchMenuItems: MenuItem[] = branchMenu
    ? [
        {
          label: "编辑描述",
          disabled: descriptionDisabled,
          onSelect: () => {
            const branch = branchMenu.branch.short_name;
            setBranchMenu(null);
            setError(null);
            setDiagnostic(null);
            setDescriptionBranch(branch);
          },
        },
        {
          label: "与 HEAD 对比",
          disabled: !repo?.head.oid,
          onSelect: () => {
            if (branchMenu) {
              compareWithHead(branchMenu.branch);
            }
          },
        },
        {
          label: "设为对比 Base",
          onSelect: () => {
            if (branchMenu) {
              slots.setSide("base", branchSlot(branchMenu.branch));
            }
          },
        },
        {
          label: "设为对比 Compare",
          onSelect: () => {
            if (branchMenu) {
              slots.setSide("compare", branchSlot(branchMenu.branch));
            }
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
        {repo && workspace && (
          <div
            className={`workspace-badge ${
              workspace.conflicted > 0 ? "conflict" : workspace.dirty ? "dirty" : "clean"
            }`}
            title={`已暂存 ${workspace.staged} · 已修改 ${workspace.tracked} · 未跟踪 ${workspace.untracked} · 冲突 ${workspace.conflicted}${
              workspace.detached ? " · detached HEAD" : ""
            }`}
          >
            {workspaceLabel(workspace)}
          </div>
        )}
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
          <button className="primary" onClick={pickRepository} disabled={busy}>
            打开仓库
          </button>
          <button onClick={refresh} disabled={busy || !repo}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
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
          {repo && (
            <div className="branch-list branch-panel">
              <div className="branch-panel-head">
                <h2>本地分支</h2>
                <button
                  className="link"
                  disabled={localBranches.length < 2}
                  onClick={() => setBranchCompareOpen(true)}
                  title="选择两个本地分支进行对比"
                >
                  对比分支…
                </button>
              </div>
              {localBranches.length === 0 ? (
                <p className="muted">没有本地分支</p>
              ) : (
                <ul>
                  {localBranches.map((branch) => (
                    <li key={branch.full_name}>
                      <button
                        className={branch.is_head ? "branch-item active" : "branch-item"}
                        title={
                          branch.description
                            ? `${branch.short_name} — ${branch.description}`
                            : branch.short_name
                        }
                        onClick={() => {
                          if (!branch.is_head && !writeDisabled) {
                            void startWrite("switch_branch", { branch: branch.short_name });
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setBranchMenu({
                            x: event.clientX,
                            y: event.clientY,
                            branch,
                          });
                        }}
                      >
                        <span className="branch-text">
                          <span className="branch-name">{branch.short_name}</span>
                          {branch.description && (
                            <span className="branch-desc">{branch.description}</span>
                          )}
                        </span>
                        {branch.is_head && <span className="tag">当前</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
        <PaneSplitter
          label="调整左侧栏宽度"
          width={sidebarWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          defaultValue={SIDEBAR_WIDTH.reset}
          onChange={setSidebarWidth}
        />

        <main className="main">
          {repo?.interruption.kinds.length ? (
            <div className="banner warning">
              <strong>{repo.interruption.message}</strong>
              {repo.interruption.files.length > 0 && (
                <span>未完成文件：{repo.interruption.files.join("、")}</span>
              )}
              {repo.interruption.terminal_hint && <code>{repo.interruption.terminal_hint}</code>}
              <span className="muted">
                本应用不会自动执行 --abort / --quit，也不会跳过冲突；写操作在中断态解除前保持禁用。
              </span>
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

          {error && (
            <div className="banner danger">
              <span className="banner-text">{error}</span>
              {diagnostic && (
                <button className="link" onClick={() => void copyText(diagnostic)}>
                  复制诊断
                </button>
              )}
            </div>
          )}

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
                twoDot={twoDot}
                onTwoDotChange={setTwoDot}
                tools={tools}
                commitMenu={commitMenuItems}
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
                    <>
                      <PaneSplitter
                        label="调整详情面板宽度"
                        width={detailWidth}
                        min={DETAIL_WIDTH.min}
                        max={detailMax}
                        defaultValue={DETAIL_WIDTH.reset}
                        invert
                        onChange={setDetailWidth}
                      />
                      <CommitDetailPane
                        repo={repo}
                        oid={selectedOid}
                        tools={tools}
                        width={detailWidth}
                        onClose={() => setSelectedOid(null)}
                        onBranchJump={(branch) => {
                          setScope({ kind: "branch", value: branch });
                          setSelectedOid(null);
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
          {repo && settings ? ` · ${settings.watch_enabled ? "监听已开启" : "监听已关闭"}` : ""}
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

      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          items={branchMenuItems}
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

      {writePrompt && (
        <ConfirmWriteDialog
          kind={writePrompt.kind}
          commit={writePrompt.commit}
          branch={writePrompt.branch}
          gate={writePrompt.gate}
          gateError={writePrompt.gateError}
          busy={writeBusy}
          onCancel={() => {
            if (!writeBusy) {
              setWritePrompt(null);
            }
          }}
          onConfirm={() => void runWrite()}
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
