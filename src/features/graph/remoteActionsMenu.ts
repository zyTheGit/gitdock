import type { GraphMessages } from "../../i18n/locales/zh-CN/graph";
import type { PullMode } from "../../shared/types";

type GraphMessageKey = `graph.${Extract<keyof GraphMessages, string>}`;
type PullMenuMode = Extract<PullMode, "ff_only" | "merge">;

/** 菜单只描述既有动作；fetch + prune 仍进入原确认框，不新增写请求。 */
export type RemoteMenuAction =
  | { kind: "fetch" }
  | { kind: "fetch_prune" }
  | { kind: "pull"; mode: PullMenuMode };

export interface RemoteMenuItem {
  id: string;
  labelKey: GraphMessageKey;
  titleKey: GraphMessageKey;
  action: RemoteMenuAction;
}

export const FETCH_MENU_ITEMS = [
  {
    id: "fetch",
    labelKey: "graph.fetch",
    titleKey: "graph.fetchTitle",
    action: { kind: "fetch" },
  },
  {
    id: "fetch-prune",
    labelKey: "graph.fetchPrune",
    titleKey: "graph.fetchPruneTitle",
    action: { kind: "fetch_prune" },
  },
] as const satisfies readonly RemoteMenuItem[];

export const PULL_MENU_ITEMS = [
  {
    id: "pull-ff-only",
    labelKey: "graph.pullFfOnlyOption",
    titleKey: "graph.pullFfOnlyTitle",
    action: { kind: "pull", mode: "ff_only" },
  },
  {
    id: "pull-merge",
    labelKey: "graph.pullMergeOption",
    titleKey: "graph.pullMergeTitle",
    action: { kind: "pull", mode: "merge" },
  },
] as const satisfies readonly RemoteMenuItem[];
