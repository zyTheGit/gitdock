import type { CustomTypeOptions } from "i18next";
import type { CommitSummaryDto, RefDto, RepoId } from "../shared/types";

export const ACTION_CONTEXTS = ["global", "graph", "compare", "staging", "refs"] as const;

export type ActionContext = (typeof ACTION_CONTEXTS)[number];
export type ActionView = "graph" | "compare" | "staging" | "search" | "welcome";
export type ActionShortcut =
  | "terminal.toggle"
  | "app.search"
  | "app.refresh"
  | "view.graph"
  | "view.staging";

export type ActionId =
  | "shell:showGraph"
  | "shell:showStaging"
  | "shell:openSearch"
  | "shell:toggleRefs"
  | "shell:refresh"
  | "shell:openSettings"
  | "repository:open"
  | "repository:closeTab"
  | "repository:activateTab"
  | "repository:createBranch"
  | "repository:createTag"
  | "graph:locateSelectedCommit"
  | "graph:openCommitDetail"
  | "graph:copyCommitHash"
  | "graph:copyCommitMessage"
  | "graph:createBranchHere"
  | "graph:createTagHere"
  | "graph:cherryPickCommit"
  | "graph:revertCommit"
  | "graph:resetBranchHere"
  | "graph:openReflog"
  | "compare:openResults"
  | "compare:pickBranches"
  | "compare:swapSides"
  | "compare:setBase"
  | "compare:setCompare"
  | "refs:locateCommit"
  | "refs:filterGraph"
  | "refs:compareWithHead"
  | "refs:switchBranch"
  | "staging:showConflicts"
  | "staging:refresh"
  | "staging:stageFile"
  | "staging:unstageFile"
  | "staging:discardFile"
  | "remote:fetch"
  | "remote:pull"
  | "remote:push"
  | "stash:open"
  | "terminal:toggle";

export type ActionTargetKind = "commit" | "ref" | "staging-file" | "repository";

export interface CommitActionTarget {
  kind: "commit";
  oid: string;
  commit?: CommitSummaryDto;
}

export interface RefActionTarget {
  kind: "ref";
  ref: RefDto;
}

export interface StagingFileActionTarget {
  kind: "staging-file";
  path: string;
  side: "staged" | "unstaged";
}

export interface RepositoryActionTarget {
  kind: "repository";
  repoId: RepoId;
}

export type ActionTarget =
  | CommitActionTarget
  | RefActionTarget
  | StagingFileActionTarget
  | RepositoryActionTarget;

export type ActionTitleKey = {
  [Namespace in keyof CustomTypeOptions["resources"]]: `${Namespace}.${Extract<
    keyof CustomTypeOptions["resources"][Namespace],
    string
  >}`;
}[keyof CustomTypeOptions["resources"]];

export type ActionRequirement =
  | "repo"
  | "workspace"
  | "write"
  | "head"
  | "compareReady"
  | "compareRefs"
  | "conflicts";

export type ActionBusyPolicy = "allow" | "disable";

export interface ActionDefinition {
  id: ActionId;
  contexts: readonly ActionContext[];
  titleKey: ActionTitleKey;
  shortcut?: ActionShortcut;
  danger?: boolean;
  targetKinds?: readonly ActionTargetKind[];
  requires?: readonly ActionRequirement[];
  busy: ActionBusyPolicy;
}

export interface ActionQueryState {
  repoOpen: boolean;
  repoBare: boolean;
  busy: boolean;
  writeDisabled: boolean;
  view: ActionView;
  selectedOid: string | null;
  hasHead?: boolean;
  compareReady: boolean;
  conflictedCount: number;
  target?: ActionTarget | null;
  activeRepoId?: RepoId | null;
  compareRefCount?: number;
}

export type ActionDisabledReason =
  | "NO_REPOSITORY"
  | "BUSY"
  | "BARE_REPOSITORY"
  | "WRITE_DISABLED"
  | "NO_SELECTED_COMMIT"
  | "NO_SELECTED_REF"
  | "NO_STAGING_FILE"
  | "NO_REPOSITORY_TARGET"
  | "INVALID_TARGET"
  | "COMPARE_INCOMPLETE"
  | "COMPARE_NEEDS_TWO_REFS"
  | "NO_CONFLICTS"
  | "STAGING_SIDE_MISMATCH"
  | "REF_WITHOUT_COMMIT"
  | "NO_HEAD_COMMIT"
  | "REF_NOT_LOCAL_BRANCH"
  | "REF_ALREADY_HEAD"
  | "REPOSITORY_ALREADY_ACTIVE";

export interface ResolvedAction {
  id: ActionId;
  contexts: readonly ActionContext[];
  titleKey: ActionTitleKey;
  shortcut?: ActionShortcut;
  danger: boolean;
  target: ActionTarget | null;
  disabledReason: ActionDisabledReason | null;
}

export type ActionHandler = (target: ActionTarget | null) => void | Promise<void>;
export type ActionHandlers = Partial<Record<ActionId, ActionHandler>>;
