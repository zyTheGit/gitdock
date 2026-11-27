// @ts-expect-error Node's native TS test runner needs the explicit extension.
import { ACTION_CATALOG } from "./actionCatalogData.ts";
import type { RefDto } from "../shared/types";
import type {
  ActionContext,
  ActionDefinition,
  ActionDisabledReason,
  ActionHandler,
  ActionHandlers,
  ActionId,
  ActionQueryState,
  ActionTarget,
  ActionTargetKind,
  ResolvedAction,
} from "./actionCatalogTypes";

export { ACTION_CATALOG };

const CATALOG: readonly ActionDefinition[] = ACTION_CATALOG;
const DEFINITIONS: ReadonlyMap<ActionId, ActionDefinition> = new Map(
  CATALOG.map((definition) => [definition.id, definition]),
);

function activeContext(view: ActionQueryState["view"]): ActionContext | null {
  return view === "graph" || view === "compare" || view === "staging" ? view : null;
}

function resolveTarget(
  definition: ActionDefinition,
  state: ActionQueryState,
  requested: ActionTarget | null,
): ActionTarget | null {
  const kinds = definition.targetKinds ?? [];
  if (kinds.length === 0) {
    return null;
  }
  if (requested !== null) {
    return requested;
  }
  if (kinds.includes("commit") && state.selectedOid) {
    return { kind: "commit", oid: state.selectedOid };
  }
  if (definition.id === "repository:closeTab" && state.activeRepoId != null) {
    return { kind: "repository", repoId: state.activeRepoId };
  }
  return null;
}

function missingTargetReason(kinds: readonly ActionTargetKind[]): ActionDisabledReason {
  if (kinds.includes("commit")) {
    return "NO_SELECTED_COMMIT";
  }
  if (kinds.includes("ref")) {
    return "NO_SELECTED_REF";
  }
  if (kinds.includes("staging-file")) {
    return "NO_STAGING_FILE";
  }
  return "NO_REPOSITORY_TARGET";
}

function refHasCommit(ref: RefDto): boolean {
  return ref.kind === "tag"
    ? Boolean(ref.commit_oid)
    : Boolean(ref.commit_oid ?? ref.target_oid);
}

function targetDisabledReason(
  definition: ActionDefinition,
  state: ActionQueryState,
  target: ActionTarget | null,
): ActionDisabledReason | null {
  const kinds = definition.targetKinds ?? [];
  if (kinds.length === 0) {
    return null;
  }
  if (target === null) {
    return missingTargetReason(kinds);
  }
  if (!kinds.includes(target.kind)) {
    return "INVALID_TARGET";
  }

  if (target.kind === "commit") {
    if (typeof target.oid !== "string" || target.oid.length === 0) {
      return "INVALID_TARGET";
    }
    return target.commit && target.commit.oid !== target.oid ? "INVALID_TARGET" : null;
  }

  if (target.kind === "repository") {
    if (!Number.isInteger(target.repoId) || target.repoId < 1) {
      return "INVALID_TARGET";
    }
    return definition.id === "repository:activateTab" && target.repoId === state.activeRepoId
      ? "REPOSITORY_ALREADY_ACTIVE"
      : null;
  }

  if (target.kind === "staging-file") {
    if (typeof target.path !== "string" || target.path.length === 0) {
      return "INVALID_TARGET";
    }
    const expectedSide =
      definition.id === "staging:stageFile" || definition.id === "staging:discardFile"
        ? "unstaged"
        : definition.id === "staging:unstageFile"
          ? "staged"
          : null;
    return expectedSide !== null && target.side !== expectedSide ? "STAGING_SIDE_MISMATCH" : null;
  }

  const ref = target.ref;
  if (!ref || typeof ref !== "object") {
    return "INVALID_TARGET";
  }
  const needsCommit =
    definition.id === "compare:setBase" ||
    definition.id === "compare:setCompare" ||
    definition.id === "refs:locateCommit" ||
    definition.id === "refs:compareWithHead";
  if (needsCommit && !refHasCommit(ref)) {
    return "REF_WITHOUT_COMMIT";
  }
  if (definition.id === "refs:switchBranch") {
    if (ref.kind !== "local_branch") {
      return "REF_NOT_LOCAL_BRANCH";
    }
    if (ref.is_head) {
      return "REF_ALREADY_HEAD";
    }
  }
  return null;
}

export function getActionDisabledReason(
  definition: ActionDefinition,
  state: ActionQueryState,
  target?: ActionTarget | null,
): ActionDisabledReason | null {
  const resolvedTarget =
    target === undefined ? resolveTarget(definition, state, state.target ?? null) : target;
  const requirements = definition.requires ?? [];
  if (requirements.includes("repo") && !state.repoOpen) {
    return "NO_REPOSITORY";
  }
  if (requirements.includes("workspace") && state.repoBare) {
    return "BARE_REPOSITORY";
  }
  if (definition.busy === "disable" && state.busy) {
    return "BUSY";
  }
  for (const requirement of requirements) {
    switch (requirement) {
      case "write":
        if (state.writeDisabled) {
          return "WRITE_DISABLED";
        }
        break;
      case "head":
        if (state.hasHead === false) {
          return "NO_HEAD_COMMIT";
        }
        break;
      case "compareReady":
        if (!state.compareReady) {
          return "COMPARE_INCOMPLETE";
        }
        break;
      case "compareRefs":
        if (state.compareRefCount !== undefined && !(state.compareRefCount >= 2)) {
          return "COMPARE_NEEDS_TWO_REFS";
        }
        break;
      case "conflicts":
        if (!(state.conflictedCount > 0)) {
          return "NO_CONFLICTS";
        }
        break;
    }
  }
  return targetDisabledReason(definition, state, resolvedTarget);
}

function resolveDefinition(
  definition: ActionDefinition,
  state: ActionQueryState,
  requestedTarget: ActionTarget | null,
): ResolvedAction {
  const target = resolveTarget(definition, state, requestedTarget);
  return {
    id: definition.id,
    contexts: definition.contexts,
    titleKey: definition.titleKey,
    ...(definition.shortcut ? { shortcut: definition.shortcut } : {}),
    danger: definition.danger ?? false,
    target,
    disabledReason: getActionDisabledReason(definition, state, target),
  };
}

export function queryActionCatalog(
  state: ActionQueryState,
  context?: ActionContext,
): ResolvedAction[] {
  const selectedContext = context ?? activeContext(state.view);
  const requestedTarget = state.target ?? null;
  return CATALOG.filter(
    (definition) =>
      definition.contexts.includes("global") ||
      (selectedContext !== null && definition.contexts.includes(selectedContext)),
  ).map((definition) => resolveDefinition(definition, state, requestedTarget));
}

export function resolveAction(
  id: ActionId,
  state: ActionQueryState,
  target?: ActionTarget | null,
): ResolvedAction | null {
  const definition = DEFINITIONS.get(id);
  if (!definition) {
    return null;
  }
  return resolveDefinition(definition, state, target === undefined ? state.target ?? null : target);
}

export function resolveActionHandler(
  action: ActionId | ResolvedAction,
  handlers: ActionHandlers,
): ActionHandler | undefined {
  if (typeof action !== "string" && action.disabledReason !== null) {
    return undefined;
  }
  const id = typeof action === "string" ? action : action.id;
  return handlers[id];
}
