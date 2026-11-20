import { useCallback, useRef } from "react";
import type { GraphScope, RefDto } from "../shared/types";
import type { GraphLoader } from "../features/graph/useGraph";
import { i18next } from "../i18n";
import { copyText } from "../shared/clipboard";
import type { ViewMode } from "./useGlobalEsc";

interface UseRefNavigationParams {
  scope: GraphScope;
  graph: GraphLoader;
  setScope: (scope: GraphScope) => void;
  setMode: (mode: ViewMode) => void;
  setSelectedOid: (oid: string | null) => void;
  setFocusTarget: (target: { oid: string; seq: number } | null) => void;
  setToast: (message: string | null) => void;
}

/**
 * 侧栏/右键菜单的只读导航：单击引用定位其提交，不触发任何写操作。
 *
 * 当前范围是「全量」时提交一定在视图中，直接跳页并聚焦；其他范围（HEAD/单个分支）
 * 可能不包含目标提交，切到该引用自己的范围——引用 tip 必然是新视图第一行。
 */
export function useRefNavigation({
  scope,
  graph,
  setScope,
  setMode,
  setSelectedOid,
  setFocusTarget,
  setToast,
}: UseRefNavigationParams) {
  const focusSeq = useRef(0);

  const focus = useCallback(
    (oid: string) => {
      focusSeq.current += 1;
      setFocusTarget({ oid, seq: focusSeq.current });
    },
    [setFocusTarget],
  );

  const navigate = useCallback(
    (ref: RefDto) => {
      const oid = ref.commit_oid ?? ref.target_oid;
      if (!oid) {
        return;
      }
      setMode("graph");
      setFocusTarget(null);
      if (scope.kind === "all") {
        // 全量视图一定包含引用 tip；跳页成功后再选中并居中，失败时不留下假选中。
        void graph.jumpTo(oid).then((ok) => {
          if (ok) {
            setSelectedOid(oid);
            focus(oid);
          }
        });
        return;
      }
      setSelectedOid(oid);
      if (scope.kind === "branch" && scope.value === ref.short_name) {
        focus(oid);
        return;
      }
      setScope({ kind: "branch", value: ref.short_name });
    },
    [focus, graph.jumpTo, scope, setFocusTarget, setMode, setScope, setSelectedOid],
  );

  const filter = useCallback(
    (ref: RefDto) => {
      setMode("graph");
      setScope({ kind: "branch", value: ref.short_name });
      setSelectedOid(null);
      setFocusTarget(null);
    },
    [setFocusTarget, setMode, setScope, setSelectedOid],
  );

  const copyOid = useCallback(
    async (oid: string) => {
      await copyText(oid);
      setToast(i18next.t("shell.oidCopied"));
    },
    [setToast],
  );

  return { navigate, filter, copyOid };
}
