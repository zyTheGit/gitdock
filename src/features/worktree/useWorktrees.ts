import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { WorktreeDto } from "../../shared/types";

export interface WorktreesResource {
  /** null = 尚未加载完成；空数组 = 已加载但没有记录。 */
  worktrees: WorktreeDto[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface WorktreesState {
  repoPath: string | null;
  worktrees: WorktreeDto[] | null;
  loading: boolean;
  error: string | null;
}

function emptyState(repoPath: string | null): WorktreesState {
  return { repoPath, worktrees: null, loading: repoPath !== null, error: null };
}

/**
 * 侧栏的 worktree 列表（ADR-0034）：随仓库切换与 generation 变化重读，不轮询。
 * 只读数据不进 generation 体系，创建/移除成功后由调用方显式 reload。
 */
export function useWorktrees(repoPath: string | null, generation: number): WorktreesResource {
  const [state, setState] = useState<WorktreesState>(() => emptyState(repoPath));
  // 仓库切换后旧请求仍可能返回：只让最新一次请求落地。
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!repoPath) {
      return;
    }
    const id = ++seq.current;
    setState((previous) =>
      previous.repoPath === repoPath
        ? { ...previous, loading: true }
        : emptyState(repoPath),
    );
    try {
      const list = await ipc.readWorktrees();
      if (seq.current === id) {
        setState((previous) =>
          previous.repoPath === repoPath
            ? { ...previous, worktrees: list, error: null, loading: false }
            : previous,
        );
      }
    } catch (err) {
      if (seq.current === id) {
        setState((previous) =>
          previous.repoPath === repoPath
            ? { ...previous, error: errorText(err), loading: false }
            : previous,
        );
      }
    }
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) {
      seq.current += 1;
      setState((previous) => (previous.repoPath === null ? previous : emptyState(null)));
      return;
    }
    void reload();
  }, [repoPath, generation, reload]);

  // 切换仓库的首帧不暴露上一条结果；同仓库刷新则保留列表，避免闪烁。
  const current = state.repoPath === repoPath ? state : emptyState(repoPath);
  return {
    worktrees: current.worktrees,
    loading: current.loading,
    error: current.error,
    reload,
  };
}
