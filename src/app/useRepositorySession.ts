import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useGraph, type GraphLoader } from "../features/graph/useGraph";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type {
  AppInfoDto,
  GraphScope,
  RepoStateDto,
  RepositoryChangedDto,
  SettingsDto,
  WorkspaceStatusDto,
} from "../shared/types";

const EVENT_REPOSITORY_CHANGED = "repository-changed";

export interface RepositorySession {
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  setSettings: (settings: SettingsDto) => void;
  repo: RepoStateDto | null;
  workspace: WorkspaceStatusDto | null;
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  diagnostic: string | null;
  setDiagnostic: (text: string | null) => void;
  toast: string | null;
  setToast: (message: string | null) => void;
  graph: GraphLoader;
  open: (path: string) => Promise<boolean>;
  forget: (path: string) => Promise<void>;
  pick: () => Promise<void>;
  refresh: () => Promise<void>;
  readSnapshot: () => Promise<[RepoStateDto, WorkspaceStatusDto]>;
  applySnapshot: (state: RepoStateDto, status: WorkspaceStatusDto) => void;
}

interface RepositorySessionOptions {
  scope: GraphScope;
  /** 打开仓库成功后先归零视图状态，再落仓库，避免旧 scope 对新仓库触发无效拉取。 */
  onOpened: () => void;
  writeBusyRef: MutableRefObject<boolean>;
}

/** 单仓库会话：打开/关闭、启动恢复、监听刷新、最新状态快照；图谱随 repo + scope 重载。 */
export function useRepositorySession({
  scope,
  onOpened,
  writeBusyRef,
}: RepositorySessionOptions): RepositorySession {
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [repo, setRepo] = useState<RepoStateDto | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const restored = useRef(false);
  const repoRef = useRef<RepoStateDto | null>(null);
  const busyRef = useRef(false);
  repoRef.current = repo;
  busyRef.current = busy;

  const graph = useGraph(repo?.path ?? null, scope);
  // graph 每次渲染都是新对象，但 reload 只在 repoPath 变化时重建；依赖它可避免监听器反复重订阅。
  const reload = graph.reload;

  const readSnapshot = useCallback(async (): Promise<[RepoStateDto, WorkspaceStatusDto]> => {
    const [state, status] = await Promise.all([ipc.repositoryState(), ipc.workspaceStatus()]);
    return [state, status];
  }, []);

  const applySnapshot = useCallback((state: RepoStateDto, status: WorkspaceStatusDto) => {
    setRepo(state);
    setWorkspace(status);
  }, []);

  const open = useCallback(
    async (path: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setWorkspace(null);
      try {
        const state = await ipc.openRepository(path);
        onOpened();
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
    },
    [onOpened],
  );

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
        const opened = startupPath ? await open(startupPath) : false;
        if (!opened && loaded.restore_last_repository) {
          const last = loaded.recent_repositories[0];
          if (last) {
            await open(last.path);
          }
        }
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, [open]);

  // 只从最近列表移除展示项，不删除磁盘上的仓库；再次打开即可重新加入。
  const forget = useCallback(async (path: string) => {
    try {
      setSettings(await ipc.forgetRecentRepository(path));
      setToast("已从最近仓库移除");
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  const pick = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "选择 Git 仓库" });
      if (typeof selected === "string") {
        await open(selected);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, [open]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [state, status] = await readSnapshot();
      applySnapshot(state, status);
      await reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [reload, readSnapshot, applySnapshot]);

  // 监听只负责标脏：事件到达后防抖刷新，写操作进行中交由写后刷新收尾。
  const autoRefresh = useCallback(async () => {
    const current = repoRef.current;
    if (!current || busyRef.current || writeBusyRef.current) {
      return;
    }
    try {
      const [state, status] = await readSnapshot();
      if (!repoRef.current || state.path !== repoRef.current.path) {
        return;
      }
      applySnapshot(state, status);
      await reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    }
  }, [reload, readSnapshot, applySnapshot, writeBusyRef]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    void listen<RepositoryChangedDto>(EVENT_REPOSITORY_CHANGED, (event) => {
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

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return {
    info,
    settings,
    setSettings,
    repo,
    workspace,
    busy,
    error,
    setError,
    diagnostic,
    setDiagnostic,
    toast,
    setToast,
    graph,
    open,
    forget,
    pick,
    refresh,
    readSnapshot,
    applySnapshot,
  };
}
