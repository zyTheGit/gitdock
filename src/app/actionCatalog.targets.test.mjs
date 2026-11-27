import assert from "node:assert/strict";
import test from "node:test";
import {
  OTHER_OID,
  commitTarget,
  entry,
  fileTarget,
  reason,
  refTarget,
  repoTarget,
  state,
} from "./actionCatalogTestFixtures.mjs";

test("resolves staging targets and enforces each action's file side", () => {
  assert.equal(reason("staging:stageFile"), "NO_STAGING_FILE");
  assert.equal(reason("staging:unstageFile"), "NO_STAGING_FILE");
  assert.equal(reason("staging:discardFile"), "NO_STAGING_FILE");
  assert.equal(reason("staging:stageFile", {}, fileTarget("unstaged")), null);
  assert.equal(reason("staging:stageFile", {}, fileTarget("staged")), "STAGING_SIDE_MISMATCH");
  assert.equal(reason("staging:unstageFile", {}, fileTarget("staged")), null);
  assert.equal(reason("staging:unstageFile", {}, fileTarget("unstaged")), "STAGING_SIDE_MISMATCH");
  assert.equal(reason("staging:discardFile", {}, fileTarget("unstaged")), null);
  assert.equal(reason("staging:discardFile", {}, fileTarget("staged")), "STAGING_SIDE_MISMATCH");
  assert.equal(entry("staging:discardFile", {}, fileTarget()).danger, true);
  assert.equal(reason("staging:stageFile", {}, commitTarget()), "INVALID_TARGET");
});

test("resolves active-tab close and explicit repository activation targets", () => {
  const active = state({ activeRepoId: 7 });
  const closed = entry("repository:closeTab", active);
  assert.deepEqual(closed.target, repoTarget(7));
  assert.equal(closed.disabledReason, null);
  assert.equal(reason("repository:closeTab", { activeRepoId: null }), "NO_REPOSITORY_TARGET");
  assert.equal(reason("repository:activateTab"), "NO_REPOSITORY_TARGET");
  assert.equal(reason("repository:activateTab", {}, repoTarget(1)), "REPOSITORY_ALREADY_ACTIVE");
  assert.equal(reason("repository:activateTab", {}, repoTarget(2)), null);
  assert.equal(reason("repository:activateTab", {}, repoTarget(0)), "INVALID_TARGET");
});

test("validates ref targets for navigation, compare, and branch switching", () => {
  const ref = refTarget();
  assert.equal(reason("refs:locateCommit", {}, ref), null);
  assert.equal(reason("refs:filterGraph", {}, ref), null);
  assert.equal(reason("refs:compareWithHead", {}, ref), null);
  assert.equal(reason("refs:compareWithHead", { hasHead: false }, ref), "NO_HEAD_COMMIT");
  assert.equal(reason("compare:setBase", {}, ref), null);
  assert.equal(reason("refs:switchBranch", {}, ref), null);
  assert.equal(reason("refs:locateCommit"), "NO_SELECTED_REF");

  const unresolved = refTarget({ commit_oid: undefined, target_oid: "" });
  assert.equal(reason("refs:locateCommit", {}, unresolved), "REF_WITHOUT_COMMIT");
  assert.equal(reason("refs:compareWithHead", {}, unresolved), "REF_WITHOUT_COMMIT");
  assert.equal(reason("compare:setCompare", {}, unresolved), "REF_WITHOUT_COMMIT");
  const unresolvedTag = refTarget({ kind: "tag", commit_oid: undefined, target_oid: OTHER_OID });
  assert.equal(reason("refs:locateCommit", {}, unresolvedTag), "REF_WITHOUT_COMMIT");
  assert.equal(reason("compare:setBase", {}, unresolvedTag), "REF_WITHOUT_COMMIT");
  assert.equal(
    reason("refs:switchBranch", {}, refTarget({ kind: "remote_branch" })),
    "REF_NOT_LOCAL_BRANCH",
  );
  assert.equal(reason("refs:switchBranch", {}, refTarget({ is_head: true })), "REF_ALREADY_HEAD");
});
