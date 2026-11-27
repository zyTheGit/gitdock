import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_CATALOG,
  getActionDisabledReason,
  queryActionCatalog,
  resolveActionHandler,
} from "./actionCatalog.ts";
import {
  OID,
  OTHER_OID,
  commitTarget,
  entry,
  fileTarget,
  ids,
  reason,
  refTarget,
  repoTarget,
  state,
} from "./actionCatalogTestFixtures.mjs";
import common from "../i18n/locales/zh-CN/common.ts";
import compare from "../i18n/locales/zh-CN/compare.ts";
import graph from "../i18n/locales/zh-CN/graph.ts";
import history from "../i18n/locales/zh-CN/history.ts";
import repository from "../i18n/locales/zh-CN/repository.ts";
import shell from "../i18n/locales/zh-CN/shell.ts";
import staging from "../i18n/locales/zh-CN/staging.ts";

const EXPECTED_IDS = [
  "shell:showGraph",
  "shell:showStaging",
  "shell:openSearch",
  "shell:toggleRefs",
  "shell:refresh",
  "shell:openSettings",
  "repository:open",
  "repository:closeTab",
  "repository:activateTab",
  "repository:createBranch",
  "repository:createTag",
  "graph:locateSelectedCommit",
  "graph:openCommitDetail",
  "graph:copyCommitHash",
  "graph:copyCommitMessage",
  "graph:createBranchHere",
  "graph:createTagHere",
  "graph:cherryPickCommit",
  "graph:revertCommit",
  "graph:resetBranchHere",
  "graph:openReflog",
  "compare:openResults",
  "compare:pickBranches",
  "compare:swapSides",
  "compare:setBase",
  "compare:setCompare",
  "refs:locateCommit",
  "refs:filterGraph",
  "refs:compareWithHead",
  "refs:switchBranch",
  "staging:showConflicts",
  "staging:refresh",
  "staging:stageFile",
  "staging:unstageFile",
  "staging:discardFile",
  "remote:fetch",
  "remote:pull",
  "remote:push",
  "stash:open",
  "terminal:toggle",
];

test("filters global and active-view actions without duplicates", () => {
  const graphIds = ids(state());
  assert(graphIds.includes("shell:refresh"));
  assert(graphIds.includes("graph:copyCommitHash"));
  assert(graphIds.includes("compare:setBase"));
  assert(!graphIds.includes("compare:openResults"));
  assert(!graphIds.includes("refs:filterGraph"));
  assert(!graphIds.includes("staging:stageFile"));
  assert.equal(new Set(graphIds).size, graphIds.length);

  const compareIds = ids(state({ view: "compare" }));
  assert(compareIds.includes("compare:openResults"));
  assert(compareIds.includes("compare:swapSides"));
  assert(!compareIds.includes("graph:copyCommitHash"));

  const stagingIds = ids(state({ view: "staging" }));
  assert(stagingIds.includes("staging:stageFile"));
  assert(!stagingIds.includes("graph:copyCommitHash"));
  assert.deepEqual(ids(state(), "staging"), stagingIds);
});

test("returns only global actions for search, welcome, and an explicit global context", () => {
  const globalIds = ids(state(), "global");
  assert.deepEqual(ids(state({ view: "search" })), globalIds);
  assert.deepEqual(ids(state({ view: "welcome" })), globalIds);
  assert(globalIds.includes("shell:openSettings"));
  assert(globalIds.includes("repository:open"));
  assert(!globalIds.includes("repository:activateTab"));
  assert(!globalIds.includes("graph:copyCommitHash"));
});

test("refs context includes global, refs, and shared compare-target actions", () => {
  const refsIds = ids(state(), "refs");
  assert(refsIds.includes("shell:refresh"));
  assert(refsIds.includes("repository:createBranch"));
  assert(refsIds.includes("refs:locateCommit"));
  assert(refsIds.includes("compare:setBase"));
  assert(refsIds.includes("compare:setCompare"));
  assert(!refsIds.includes("graph:copyCommitHash"));
  assert(!refsIds.includes("staging:stageFile"));
});

test("keeps global entry points usable without a repository and disables repo actions", () => {
  const noRepo = state({
    repoOpen: false,
    view: "welcome",
    selectedOid: null,
    activeRepoId: null,
    target: null,
  });
  assert.equal(reason("shell:openSettings", noRepo), null);
  assert.equal(reason("repository:open", noRepo), null);
  for (const id of [
    "shell:refresh",
    "shell:openSearch",
    "shell:showStaging",
    "terminal:toggle",
    "repository:createBranch",
    "graph:copyCommitHash",
    "compare:pickBranches",
    "staging:showConflicts",
  ]) {
    assert.equal(reason(id, noRepo), "NO_REPOSITORY", id);
  }
  assert(!ids(noRepo).includes("graph:copyCommitHash"));
});

test("busy disables refresh, repository switching, conflicts, and writes but not navigation", () => {
  const busy = state({ busy: true, writeDisabled: true, conflictedCount: 1 });
  for (const id of [
    "shell:refresh",
    "repository:open",
    "repository:createBranch",
    "graph:cherryPickCommit",
    "staging:showConflicts",
  ]) {
    assert.equal(reason(id, busy), "BUSY", id);
  }
  assert.equal(reason("repository:closeTab", busy, repoTarget()), "BUSY");
  assert.equal(reason("repository:activateTab", busy, repoTarget()), "BUSY");
  assert.equal(reason("staging:stageFile", busy, fileTarget()), "BUSY");
  assert.equal(reason("repository:open", { ...busy, repoOpen: false }), "BUSY");

  for (const id of [
    "shell:openSettings",
    "shell:showGraph",
    "shell:openSearch",
    "graph:copyCommitHash",
    "graph:openReflog",
    "compare:openResults",
    "compare:pickBranches",
    "terminal:toggle",
  ]) {
    assert.equal(reason(id, busy), null, id);
  }
});

test("bare repositories disable workspace actions while preserving read-only actions", () => {
  const bare = state({ repoBare: true, conflictedCount: 1 });
  for (const id of [
    "shell:showStaging",
    "repository:createBranch",
    "repository:createTag",
    "graph:createBranchHere",
    "graph:cherryPickCommit",
    "staging:showConflicts",
    "staging:refresh",
  ]) {
    assert.equal(reason(id, bare), "BARE_REPOSITORY", id);
  }
  assert.equal(reason("refs:switchBranch", bare, refTarget()), "BARE_REPOSITORY");
  assert.equal(reason("staging:stageFile", bare, fileTarget()), "BARE_REPOSITORY");
  assert.equal(reason("staging:discardFile", bare, fileTarget()), "BARE_REPOSITORY");

  for (const id of [
    "shell:refresh",
    "graph:copyCommitHash",
    "graph:openReflog",
    "compare:openResults",
    "terminal:toggle",
  ]) {
    assert.equal(reason(id, bare), null, id);
  }
});

test("commit-target actions require a selection unless an explicit target is supplied", () => {
  const noSelection = state({ selectedOid: null, target: null });
  for (const id of [
    "graph:locateSelectedCommit",
    "graph:openCommitDetail",
    "graph:copyCommitHash",
    "graph:copyCommitMessage",
    "graph:createBranchHere",
    "graph:createTagHere",
    "graph:cherryPickCommit",
    "graph:revertCommit",
    "graph:resetBranchHere",
    "compare:setBase",
    "compare:setCompare",
  ]) {
    assert.equal(reason(id, noSelection), "NO_SELECTED_COMMIT", id);
    assert.equal(entry(id, noSelection)?.target, null, id);
  }
  assert.equal(reason("repository:createBranch", noSelection), null);
  assert.equal(reason("repository:createTag", noSelection), null);

  const target = commitTarget(OTHER_OID);
  const resolved = entry("graph:copyCommitHash", noSelection, target);
  assert.equal(resolved.disabledReason, null);
  assert.equal(resolved.target, target);
});

test("incomplete compare slots disable result actions but not the existing picker", () => {
  const incomplete = state({ compareReady: false });
  assert.equal(reason("compare:openResults", incomplete), "COMPARE_INCOMPLETE");
  assert.equal(reason("compare:swapSides", incomplete), "COMPARE_INCOMPLETE");
  assert.equal(reason("compare:pickBranches", incomplete), null);
  assert.equal(reason("compare:setBase", incomplete), null);
  assert.equal(reason("compare:setCompare", incomplete), null);
  assert.equal(
    reason("compare:pickBranches", { ...incomplete, compareRefCount: 1 }),
    "COMPARE_NEEDS_TWO_REFS",
  );
  assert.equal(
    reason("compare:pickBranches", { ...incomplete, compareRefCount: undefined }),
    null,
  );
});

test("writeDisabled preserves read-only actions and blocks every write descriptor", () => {
  const disabled = state({ writeDisabled: true, conflictedCount: 1 });
  for (const id of [
    "repository:createBranch",
    "repository:createTag",
    "graph:createBranchHere",
    "graph:createTagHere",
    "graph:cherryPickCommit",
    "graph:revertCommit",
    "graph:resetBranchHere",
  ]) {
    assert.equal(reason(id, disabled), "WRITE_DISABLED", id);
  }
  assert.equal(reason("refs:switchBranch", disabled, refTarget()), "WRITE_DISABLED");
  assert.equal(reason("staging:stageFile", disabled, fileTarget()), "WRITE_DISABLED");
  assert.equal(reason("staging:unstageFile", disabled, fileTarget("staged")), "WRITE_DISABLED");
  assert.equal(reason("staging:discardFile", disabled, fileTarget()), "WRITE_DISABLED");

  for (const id of [
    "shell:refresh",
    "graph:copyCommitHash",
    "graph:locateSelectedCommit",
    "graph:openReflog",
    "compare:openResults",
    "compare:setBase",
    "staging:refresh",
    "staging:showConflicts",
    "terminal:toggle",
  ]) {
    assert.equal(reason(id, disabled), null, id);
  }
});

test("keeps stable IDs, existing title keys, contexts, shortcuts, and danger metadata", () => {
  assert.deepEqual(ACTION_CATALOG.map((action) => action.id), EXPECTED_IDS);
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  const resources = { common, compare, graph, history, repository, shell, staging };
  const contexts = new Set(["global", "graph", "compare", "staging", "refs"]);
  const shortcuts = new Set([
    "terminal.toggle",
    "app.search",
    "app.refresh",
    "view.graph",
    "view.staging",
  ]);
  for (const action of ACTION_CATALOG) {
    assert(action.contexts.length > 0 || action.id === "repository:activateTab", action.id);
    assert(action.contexts.every((context) => contexts.has(context)));
    assert(["allow", "disable"].includes(action.busy));
    if (action.shortcut) {
      assert(shortcuts.has(action.shortcut), action.id);
    }
    const [namespace, key] = action.titleKey.split(".");
    assert.equal(typeof resources[namespace][key], "string", action.titleKey);
  }
  assert.deepEqual(
    ACTION_CATALOG.filter((action) => action.danger).map((action) => action.id),
    ["graph:resetBranchHere", "staging:discardFile"],
  );
});

test("resolves the same stable handler and refuses handlers for disabled entries", () => {
  const calls = [];
  const refresh = () => calls.push("refresh");
  const copy = (target) => calls.push(target);
  const handlers = {
    "shell:refresh": refresh,
    "graph:copyCommitHash": copy,
  };
  assert.equal(resolveActionHandler("shell:refresh", handlers), refresh);
  assert.equal(resolveActionHandler(entry("shell:refresh"), handlers), refresh);

  const selected = entry("graph:copyCommitHash");
  const handler = resolveActionHandler(selected, handlers);
  assert.equal(handler, copy);
  handler(selected.target);
  assert.deepEqual(calls, [commitTarget()]);
  assert.equal(resolveActionHandler(entry("graph:copyCommitHash", { selectedOid: null }), handlers), undefined);
  assert.equal(resolveActionHandler("missing", handlers), undefined);
});

test("exposes pure disable checks and does not mutate query state or targets", () => {
  const definition = ACTION_CATALOG.find((action) => action.id === "graph:copyCommitHash");
  const target = Object.freeze(commitTarget());
  const queryState = Object.freeze(state({ target }));
  assert.equal(getActionDisabledReason(definition, queryState, target), null);
  assert.equal(getActionDisabledReason(definition, queryState), null);
  assert.equal(getActionDisabledReason(definition, queryState, null), "NO_SELECTED_COMMIT");
  const first = queryActionCatalog(queryState);
  const second = queryActionCatalog(queryState);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.find((action) => action.id === "graph:copyCommitHash").target, target);
  assert.equal(queryState.selectedOid, OID);
  assert.deepEqual(ACTION_CATALOG.map((action) => action.id), EXPECTED_IDS);
});
