import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphLoader } from "../features/graph/useGraph";
import type { GraphScope } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

interface UseGraphJumpParams {
  scope: GraphScope;
  graph: GraphLoader;
  setScope: (scope: GraphScope) => void;
  setMode: (mode: ViewMode) => void;
  setSelectedOid: (oid: string | null) => void;
  setFocusTarget: (target: { oid: string; seq: number } | null) => void;
}

/**
 * 从详情面板（父提交等）跳转到图谱中的任意提交。
 *
 * 当前视图已含该提交时直接按当前范围载入目标页；否则先切到「全量」，等
 * scope 生效后再定位——非全量范围只保证包含 ref 可达的提交，父提交可能
 * 落在范围之外。定位成功才选中并居中，失败不留下假选中。
 */
export function useGraphJump({
  scope,
  graph,
  setScope,
  setMode,
  setSelectedOid,
  setFocusTarget,
}: UseGraphJumpParams) {
  const focusSeq = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const jumpTo = graph.jumpTo;

  const locate = useCallback(
    async (oid: string) => {
      const ok = await jumpTo(oid);
      if (!ok) {
        return;
      }
      setSelectedOid(oid);
      focusSeq.current += 1;
      setFocusTarget({ oid, seq: focusSeq.current });
    },
    [jumpTo, setFocusTarget, setSelectedOid],
  );

  const jumpToOid = useCallback(
    (oid: string) => {
      setMode("graph");
      const inView = graph.view.rows.some(
        (row) => (row.commit?.oid ?? row.layout.oid) === oid,
      );
      if (scope.kind === "all" || inView) {
        setPending(null);
        void locate(oid);
        return;
      }
      setPending(oid);
      setScope({ kind: "all" });
    },
    [graph.view.rows, locate, scope.kind, setMode, setScope],
  );

  useEffect(() => {
    if (!pending || scope.kind !== "all") {
      return;
    }
    setPending(null);
    void locate(pending);
  }, [pending, scope.kind, locate]);

  return jumpToOid;
}
