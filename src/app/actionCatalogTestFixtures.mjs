import { queryActionCatalog, resolveAction } from "./actionCatalog.ts";

export const OID = "0123456789abcdef0123456789abcdef01234567";
export const OTHER_OID = "fedcba9876543210fedcba9876543210fedcba98";

export function state(overrides = {}) {
  return {
    repoOpen: true,
    repoBare: false,
    busy: false,
    writeDisabled: false,
    view: "graph",
    selectedOid: OID,
    hasHead: true,
    compareReady: true,
    conflictedCount: 0,
    compareRefCount: 2,
    activeRepoId: 1,
    target: null,
    ...overrides,
  };
}

export function commitTarget(oid = OID) {
  return { kind: "commit", oid };
}

export function refTarget(overrides = {}) {
  return {
    kind: "ref",
    ref: {
      full_name: "refs/heads/feature",
      short_name: "feature",
      kind: "local_branch",
      target_oid: OID,
      commit_oid: OID,
      is_head: false,
      ...overrides,
    },
  };
}

export function repoTarget(repoId = 2) {
  return { kind: "repository", repoId };
}

export function fileTarget(side = "unstaged", path = "src/app.tsx") {
  return { kind: "staging-file", path, side };
}

export function entry(id, overrides = {}, target) {
  return resolveAction(id, state(overrides), target);
}

export function reason(id, overrides = {}, target) {
  return entry(id, overrides, target)?.disabledReason;
}

export function ids(queryState, context) {
  return queryActionCatalog(queryState, context).map((action) => action.id);
}
