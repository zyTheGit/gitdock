import { useCallback, useRef, useState } from "react";
import { ipc } from "../shared/ipc";
import type {
  RepoId,
  RepoListDto,
  RepoStateDto,
  RepoTabDto,
  SettingsDto,
} from "../shared/types";

/** 打开/激活结果：wasOpen 区分「新增标签」与「切回已有标签」。 */
export interface RepoOpenResult {
  state: RepoStateDto;
  repoId: RepoId | null;
  wasOpen: boolean;
}

export interface RepoActivateResult {
  state: RepoStateDto;
  activeId: RepoId;
}

export interface RepoCloseResult {
  /** 接替成为活动仓库的最新状态；null 表示没有剩余标签。 */
  state: RepoStateDto | null;
  activeId: RepoId | null;
}

export interface RepoRestoreResult {
  state: RepoStateDto | null;
  activeId: RepoId | null;
  /** 未能恢复的路径（被删除、权限不足或超出上限），按打开顺序。 */
  failures: string[];
}

export interface RepoTabsHandle {
  tabs: RepoTabDto[];
  activeId: RepoId | null;
  /** 非活动标签收到 repository-changed 时标脏，切回后清除。 */
  dirtyIds: readonly RepoId[];
  busy: boolean;
  open: (path: string) => Promise<RepoOpenResult>;
  activate: (repoId: RepoId) => Promise<RepoActivateResult>;
  close: (repoId: RepoId) => Promise<RepoCloseResult>;
  /** 启动恢复：按 settings.open_repositories 顺序打开，再激活上次活动仓库。 */
  restore: (settings: SettingsDto) => Promise<RepoRestoreResult>;
  sync: () => Promise<void>;
  markDirty: (repoId: RepoId) => void;
  clearDirty: (repoId: RepoId) => void;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/**
 * 多仓库标签页状态（ADR-0032）：标签列表与活动 id 的唯一来源是 list_repositories。
 * 所有变更走串行队列：后发的操作一定在前一次完成后再执行，旧响应不可能覆盖新状态。
 */
export function useRepoTabs(): RepoTabsHandle {
  const [tabs, setTabs] = useState<RepoTabDto[]>([]);
  const [activeId, setActiveId] = useState<RepoId | null>(null);
  const [dirtyIds, setDirtyIds] = useState<readonly RepoId[]>([]);
  const [busy, setBusy] = useState(false);

  const tabsRef = useRef<RepoTabDto[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  const publish = useCallback((list: RepoListDto) => {
    tabsRef.current = list.repos;
    setTabs(list.repos);
    setActiveId(list.active);
    setDirtyIds((prev) => prev.filter((id) => list.repos.some((tab) => tab.repo_id === id)));
  }, []);

  const run = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    pending.current += 1;
    setBusy(true);
    const next = queue.current.then(task, task);
    queue.current = next
      .catch(() => undefined)
      .finally(() => {
        pending.current -= 1;
        if (pending.current === 0) {
          setBusy(false);
        }
      });
    return next;
  }, []);

  const sync = useCallback(
    () =>
      run(async () => {
        publish(await ipc.listRepositories());
      }),
    [publish, run],
  );

  const open = useCallback(
    (path: string) =>
      run(async (): Promise<RepoOpenResult> => {
        const state = await ipc.openRepository(path);
        const before = tabsRef.current;
        const list = await ipc.listRepositories();
        publish(list);
        const repoId =
          list.active ?? list.repos.find((tab) => samePath(tab.path, state.path))?.repo_id ?? null;
        if (repoId !== null) {
          setDirtyIds((prev) => prev.filter((id) => id !== repoId));
        }
        return {
          state,
          repoId,
          wasOpen: repoId !== null && before.some((tab) => tab.repo_id === repoId),
        };
      }),
    [publish, run],
  );

  const activate = useCallback(
    (repoId: RepoId) =>
      run(async (): Promise<RepoActivateResult> => {
        const state = await ipc.activateRepository(repoId);
        publish(await ipc.listRepositories());
        setDirtyIds((prev) => prev.filter((id) => id !== repoId));
        return { state, activeId: repoId };
      }),
    [publish, run],
  );

  const close = useCallback(
    (repoId: RepoId) =>
      run(async (): Promise<RepoCloseResult> => {
        const state = await ipc.closeRepository(repoId);
        const list = await ipc.listRepositories();
        publish(list);
        return { state, activeId: list.active };
      }),
    [publish, run],
  );

  // 启动恢复走单次命令（ADR-0036）：后端只给活动仓库读状态，其余标签延迟到首次切换。
  const restore = useCallback(
    (settings: SettingsDto) =>
      run(async (): Promise<RepoRestoreResult> => {
        const dto = await ipc.restoreRepositories(
          settings.open_repositories ?? [],
          settings.active_repository ?? null,
        );
        publish(dto.list);
        return { state: dto.active_state, activeId: dto.list.active, failures: dto.failures };
      }),
    [publish, run],
  );

  const markDirty = useCallback((repoId: RepoId) => {
    setDirtyIds((prev) => (prev.includes(repoId) ? prev : [...prev, repoId]));
  }, []);

  const clearDirty = useCallback((repoId: RepoId) => {
    setDirtyIds((prev) => (prev.includes(repoId) ? prev.filter((id) => id !== repoId) : prev));
  }, []);

  return {
    tabs,
    activeId,
    dirtyIds,
    busy,
    open,
    activate,
    close,
    restore,
    sync,
    markDirty,
    clearDirty,
  };
}

