import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../../shared/ipc";
import type { CommitBranchContextDto, CommitSummaryDto } from "../../shared/types";

export interface CommitHover {
  commit: CommitSummaryDto;
  lane: number;
  anchorX: number;
  anchorY: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}

/**
 * 节点悬浮卡状态：悬停 Graph 节点圆点立即查询分支归属（0ms 延迟，limit=0 跳过 gap 计算），
 * 并按提交缓存；锚点取节点圆点中心，供浮窗水平对齐与绘制连接线。
 */
export function useCommitHover(viewKey: string) {
  const [hover, setHover] = useState<CommitHover | null>(null);
  const branchContextCache = useRef(new Map<string, CommitBranchContextDto>());
  const branchContextSeq = useRef(0);

  useEffect(() => {
    branchContextCache.current.clear();
    branchContextSeq.current += 1;
  }, [viewKey]);

  const cancelHover = useCallback(() => {
    branchContextSeq.current += 1;
    setHover(null);
  }, []);

  const queueHover = useCallback(
    (anchorX: number, anchorY: number, commit: CommitSummaryDto, lane: number) => {
      const cached = branchContextCache.current.get(commit.oid) ?? null;
      if (cached) {
        setHover({
          commit,
          lane,
          anchorX,
          anchorY,
          context: cached,
          contextLoading: false,
        });
        return;
      }
      const seq = ++branchContextSeq.current;
      void ipc
        .commitBranchContext(commit.oid, 0)
        .then((context) => {
          branchContextCache.current.set(commit.oid, context);
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover({
            commit,
            lane,
            anchorX,
            anchorY,
            context,
            contextLoading: false,
          });
        })
        .catch(() => {
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover(null);
        });
    },
    [],
  );

  useEffect(() => cancelHover, [cancelHover]);

  return { hover, queueHover, cancelHover };
}
