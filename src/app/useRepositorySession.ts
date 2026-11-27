import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { i18next, useI18n } from "../i18n";
import { useGraph, type GraphLoader } from "../features/graph/useGraph";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type {
  AppInfoDto,
  GraphScope,
  RepoId,
  RepoStateDto,
  RepositoryChangedDto,
  SettingsDto,
  WorkspaceStatusDto,
} from "../shared/types";
import type { RepoOpenResult } from "./useRepoTabs";

const EVENT_REPOSITORY_CHANGED = "repository-changed";

export interface RepositorySession {
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  setSettings: (settings: SettingsDto) => void;
  repo: RepoStateDto | null;
  workspace: WorkspaceStatusDto | null;
  busy: boolean;
  /** 仅「新增/打开仓库」期间为 true：各视图据此显示导入提示。 */
  opening: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  diagnostic: string | null;
  setDiagnostic: (text: string | null) => void;
  toast: string | null;
  setToast: (message: string | null) => void;
  graph: GraphLoader;
  /** 活动仓库收到底层变化事件时的单调计数（供 StagingView 等子视图订阅，避免重复监听 Tauri 事件）。 */
  changeTick: number;
  open: (path: string) => Promise<boolean>;
  forget: (path: string) => Promise<void>;
  pick: () => Promise<void>;
  refresh: () => Promise<void>;
  readSnapshot: () => Promise<[RepoStateDto, WorkspaceStatusDto]>;
  applySnapshot: (state: RepoStateDto, status: WorkspaceStatusDto) => void;
  /** 标签切换/关闭后落地后端返回的活动仓库状态；null 表示回到欢迎页。 */
  applyActiveState: (state: RepoStateDto | null) => Promise<void>;
  /** 标签操作会静默改写 open_repositories；设置弹窗保存前必须拿到最新设置。 */
  reloadSettings: () => Promise<void>;
}

interface RepositorySessionOptions {
  scope: GraphScope;
  /** 当前活动标签 id：事件按它路由到本会话或不活动标签的脏点。 */
  activeRepoId: RepoId | null;
  /** 打开或激活标签（useRepoTabs.open）；成功后由会话落地快照。 */
  openTab: (path: string) => Promise<RepoOpenResult>;
  /** 打开/激活完成后同步每标签视图态（新标签归零，已有标签恢复）。 */
  onOpened: (result: RepoOpenResult) => void;
  /** 非活动标签收到仓库变更：只标脏，不拉取图谱（ADR-0032）。 */
  onBackgroundChange: (repoId: RepoId) => void;
  writeBusyRef: MutableRefObject<boolean>;
}

/** 仓库会话：打开/激活标签、监听刷新、最新状态快照；图谱随 repo + scope 重载。 */
export function useRepositorySession({
  scope,
  activeRepoId,
  openTab,
  onOpened,
  onBackgroundChange,
  writeBusyRef,
}: RepositorySessionOptions): RepositorySession {
  const { t } = useI18n();
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [repo, setRepo] = useState<RepoStateDto | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [changeTick, setChangeTick] = useState(0);

  const repoRef = useRef<RepoStateDto | null>(null);
  const busyRef = useRef(false);
  const activeIdRef = useRef<RepoId | null>(activeRepoId);
  const backgroundRef = useRef(onBackgroundChange);
  repoRef.current = repo;
  busyRef.current = busy;
  activeIdRef.current = activeRepoId;
  backgroundRef.current = onBackgroundChange;

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

  const applyActiveState = useCallback(async (state: RepoStateDto | null) => {
    setRepo(state);
    setWorkspace(state ? await ipc.workspaceStatus().catch(() => null) : null);
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await ipc.loadSettings());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  const open = useCallback(
    async (path: string): Promise<boolean> => {
      setBusy(true);
      setOpening(true);
      setError(null);
      setDiagnostic(null);
      setWorkspace(null);
      try {
        const result = await openTab(path);
        // 视图态先归零或恢复，再落仓库：同一次批量更新里避免旧 scope 对新仓库发请求。
        onOpened(result);
        setRepo(result.state);
        // 徽章与「最近打开」写回不阻塞导入完成；图谱随 repo 变化独立加载，
        // 结果回来时若已切到别的仓库则丢弃，避免旧仓库状态覆盖新视图。
        const openedPath = result.state.path;
        void Promise.all([
          ipc.workspaceStatus().catch(() => null),
          ipc.rememberRepository(openedPath),
        ])
          .then(([status, settings]) => {
            if (repoRef.current?.path !== openedPath) {
              return;
            }
            setWorkspace(status);
            setSettings(settings);
          })
          .catch((err) => setError(errorText(err)));
        return true;
      } catch (err) {
        setWorkspace(null);
        setError(errorText(err));
        return false;
      } finally {
        setOpening(false);
        setBusy(false);
      }
    },
    [onOpened, openTab],
  );

  // 启动只准备好应用信息与设置；仓库恢复由 App 按标签列表统一发起。
  useEffect(() => {
    void (async () => {
      try {
        const [appInfo, loaded] = await Promise.all([ipc.appInfo(), ipc.loadSettings()]);
        setInfo(appInfo);
        setSettings(loaded);
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, []);

  // 只从最近列表移除展示项，不删除磁盘上的仓库；再次打开即可重新加入。
  const forget = useCallback(async (path: string) => {
    try {
      setSettings(await ipc.forgetRecentRepository(path));
      setToast(t("repository.removedFromRecent"));
    } catch (err) {
      setError(errorText(err));
    }
  }, [t]);

  const pick = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("repository.pickDialogTitle"),
      });
      if (typeof selected === "string") {
        await open(selected);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, [open, t]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDiagnostic(null);
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
      const activeId = activeIdRef.current;
      // 非活动标签的变化只标脏：拉取图谱留给切回该标签时进行（ADR-0032）。
      if (activeId !== null && event.payload.repo_id !== activeId) {
        backgroundRef.current(event.payload.repo_id);
        return;
      }
      const current = repoRef.current;
      if (!current || event.payload.path !== current.path) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) {
          setChangeTick((tick) => tick + 1);
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
      .catch((err) => setError(i18next.t("repository.watchError", { error: errorText(err) })));
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
    opening,
    error,
    setError,
    diagnostic,
    setDiagnostic,
    toast,
    setToast,
    graph,
    changeTick,
    open,
    forget,
    pick,
    refresh,
    readSnapshot,
    applySnapshot,
    applyActiveState,
    reloadSettings,
  };
}
