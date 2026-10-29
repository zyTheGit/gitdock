import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ipc } from "../../shared/ipc";
import type { CommitBranchContextDto, CommitSummaryDto } from "../../shared/types";

export interface CommitHover {
  commit: CommitSummaryDto;
  x: number;
  y: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}

/**
 * 行悬浮卡状态：短暂停留后再查询分支差异，并按提交缓存；
 * viewKey 变化（仓库刷新）后缓存与进行中的请求一起失效。
 */
export function useCommitHover(viewKey: string) {
  const [hover, setHover] = useState<CommitHover | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const branchContextCache = useRef(new Map<string, CommitBranchContextDto>());
  const branchContextSeq = useRef(0);

  useEffect(() => {
    branchContextCache.current.clear();
    branchContextSeq.current += 1;
  }, [viewKey]);

  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    branchContextSeq.current += 1;
    setHover(null);
  }, []);

  // 短暂停留后再显示，避免快速划过时频繁弹卡。
  const queueHover = useCallback((event: MouseEvent, commit: CommitSummaryDto) => {
    const { clientX: x, clientY: y } = event;
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const cached = branchContextCache.current.get(commit.oid) ?? null;
      setHover({ commit, x, y, context: cached, contextLoading: cached === null });
      if (cached) {
        return;
      }
      const seq = ++branchContextSeq.current;
      void ipc
        .commitBranchContext(commit.oid, 2)
        .then((context) => {
          branchContextCache.current.set(commit.oid, context);
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover((current) =>
            current && current.commit.oid === commit.oid
              ? { ...current, context, contextLoading: false }
              : current,
          );
        })
        .catch(() => {
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover((current) =>
            current && current.commit.oid === commit.oid
              ? { ...current, contextLoading: false }
              : current,
          );
        });
    }, 260);
  }, []);

  useEffect(() => cancelHover, [cancelHover]);

  return { hover, queueHover, cancelHover };
}
