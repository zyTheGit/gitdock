import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { WorktreeDto } from "../../shared/types";

export interface WorktreesResource {
  /** null = 尚未加载完成；空数组 = 已加载但没有记录（含仅主 worktree 的仓库）。 */
  worktrees: WorktreeDto[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 侧栏的 worktree 列表（ADR-0034）：随仓库切换与 generation 变化重读，不轮询。
 * 只读数据不进 generation 体系，创建/移除成功后由调用方显式 reload。
 */
export function useWorktrees(repoPath: string | null, generation: number): WorktreesResource {
  const [worktrees, setWorktrees] = useState<WorktreeDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousPath = useRef(repoPath);
  // 仓库切换后旧请求仍可能返回：只让最新一次请求落地。
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const list = await ipc.readWorktrees();
      if (seq.current === id) {
        setWorktrees(list);
        setError(null);
      }
    } catch (err) {
      if (seq.current === id) {
        setError(errorText(err));
      }
    } finally {
      if (seq.current === id) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (previousPath.current !== repoPath) {
      previousPath.current = repoPath;
      seq.current += 1;
      setWorktrees(null);
      setError(null);
    }
    if (!repoPath) {
      return;
    }
    void reload();
  }, [repoPath, generation, reload]);

  return { worktrees, loading, error, reload };
}
