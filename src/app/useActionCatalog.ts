import { useCallback } from "react";
import type { CommandPaletteItem } from "../features/commands/commandSearch";
import { useI18n } from "../i18n";
import { displaySpec, useBindings } from "../shared/keybindings";
import {
  queryActionCatalog,
  resolveAction,
  resolveActionHandler,
} from "./actionCatalog";
import type {
  ActionContext,
  ActionDisabledReason,
  ActionHandler,
  ActionTitleKey,
  ActionHandlers,
  ActionId,
  ActionQueryState,
  ActionTarget,
  ResolvedAction,
} from "./actionCatalogTypes";

const CONTEXT_KEYS = {
  global: "commands.contextGlobal",
  graph: "commands.contextGraph",
  compare: "commands.contextCompare",
  staging: "commands.contextStaging",
  refs: "commands.contextRefs",
} as const;

const DISABLED_KEYS: Partial<Record<ActionDisabledReason, ActionTitleKey>> = {
  NO_REPOSITORY: "commands.disabledNoRepo",
  BUSY: "commands.disabledBusy",
  BARE_REPOSITORY: "commands.disabledBare",
  COMPARE_INCOMPLETE: "commands.disabledCompare",
  COMPARE_NEEDS_TWO_REFS: "commands.disabledCompareRefs",
  WRITE_DISABLED: "commands.disabledWrite",
  NO_CONFLICTS: "commands.disabledNoConflicts",
  NO_HEAD_COMMIT: "commands.disabledNoHead",
  NO_SELECTED_REF: "commands.disabledSelectRef",
  NO_REPOSITORY_TARGET: "commands.disabledSelectRepository",
  INVALID_TARGET: "commands.disabledInvalidTarget",
  STAGING_SIDE_MISMATCH: "commands.disabledStagingSide",
  REF_WITHOUT_COMMIT: "commands.disabledRefWithoutCommit",
  REF_NOT_LOCAL_BRANCH: "commands.disabledLocalBranchOnly",
  REF_ALREADY_HEAD: "commands.disabledAlreadyHead",
  REPOSITORY_ALREADY_ACTIVE: "commands.disabledRepositoryActive",
};

export type ActionExecutor = (id: ActionId, target?: ActionTarget | null) => boolean;

interface UseActionCatalogParams {
  state: ActionQueryState;
  handlers: ActionHandlers;
}

function activeContext(state: ActionQueryState): ActionContext | null {
  return state.view === "graph" || state.view === "compare" || state.view === "staging"
    ? state.view
    : null;
}

function actionContext(action: ResolvedAction, state: ActionQueryState): ActionContext {
  const current = activeContext(state);
  return current && action.contexts.includes(current) ? current : "global";
}

export function useActionCatalog({ state, handlers }: UseActionCatalogParams): {
  items: CommandPaletteItem[];
  execute: ActionExecutor;
} {
  const { t } = useI18n();
  const bindings = useBindings();
  const items = queryActionCatalog(state)
    .filter((action) => {
      // 命令面板无显式实体上下文：因缺目标而不可执行的动作直接不列出，避免满屏不可点条目。
      const reason = action.disabledReason;
      if (!reason) {
        return true;
      }
      if (
        reason === "NO_SELECTED_REF" ||
        reason === "NO_STAGING_FILE" ||
        reason === "NO_REPOSITORY_TARGET"
      ) {
        return false;
      }
      return !(reason === "NO_SELECTED_COMMIT" && state.selectedOid === null);
    })
    .map((action) => {
    const context = actionContext(action, state);
    const disabledKey = action.disabledReason
      ? DISABLED_KEYS[action.disabledReason] ?? "commands.disabledSelection"
      : null;
    return {
      id: action.id,
      title: t(action.titleKey),
      context: t(CONTEXT_KEYS[context]),
      ...(action.shortcut ? { shortcut: displaySpec(bindings[action.shortcut]) } : {}),
      ...(disabledKey ? { disabledReason: t(disabledKey) } : {}),
      keywords: `${action.id} ${action.titleKey}`,
    };
  });

  const execute = useCallback<ActionExecutor>(
    (id, target) => {
      const action = resolveAction(id, state, target);
      if (!action) {
        return false;
      }
      const handler: ActionHandler | undefined = resolveActionHandler(action, handlers);
      if (!handler) {
        return false;
      }
      void handler(action.target);
      return true;
    },
    [handlers, state],
  );

  return { items, execute };
}
