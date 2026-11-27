import assert from "node:assert/strict";
import test from "node:test";
import { classifyCompareRelation, summarizeCompareFiles } from "./compareSummary.ts";

test("classifies all compare topology relations accurately", () => {
  const ff = classifyCompareRelation({
    sameCommit: false,
    worktree: false,
    twoDot: false,
    mode: "three_dot",
    baseOnly: 0,
    compareOnly: 5,
  });
  assert.equal(ff.kind, "fast_forward");
  assert.equal(ff.showRatioBar, true);
  assert.equal(ff.basePct, 0);
  assert.equal(ff.comparePct, 100);

  const behind = classifyCompareRelation({
    sameCommit: false,
    worktree: false,
    twoDot: false,
    mode: "three_dot",
    baseOnly: 3,
    compareOnly: 0,
  });
  assert.equal(behind.kind, "behind");
  assert.equal(behind.basePct, 100);

  const diverged = classifyCompareRelation({
    sameCommit: false,
    worktree: false,
    twoDot: false,
    mode: "three_dot",
    baseOnly: 2,
    compareOnly: 6,
  });
  assert.equal(diverged.kind, "diverged");
  assert.equal(diverged.basePct, 25);
  assert.equal(diverged.comparePct, 75);

  const same = classifyCompareRelation({
    sameCommit: true,
    worktree: false,
    twoDot: false,
    mode: "three_dot",
    baseOnly: 0,
    compareOnly: 0,
  });
  assert.equal(same.kind, "same_commit");
  assert.equal(same.showRatioBar, false);

  const fallback = classifyCompareRelation({
    sameCommit: false,
    worktree: false,
    twoDot: false,
    mode: "two_dot_fallback",
    baseOnly: 4,
    compareOnly: 4,
  });
  assert.equal(fallback.kind, "no_common_ancestor");
  assert.equal(fallback.showRatioBar, false);

  const worktree = classifyCompareRelation({
    sameCommit: false,
    worktree: true,
    twoDot: false,
    mode: "worktree",
    baseOnly: 0,
    compareOnly: 0,
  });
  assert.equal(worktree.kind, "worktree");
  assert.equal(worktree.showRatioBar, false);

  const twoDot = classifyCompareRelation({
    sameCommit: false,
    worktree: false,
    twoDot: true,
    mode: "two_dot",
    baseOnly: 2,
    compareOnly: 3,
  });
  assert.equal(twoDot.kind, "two_dot");
  assert.equal(twoDot.showRatioBar, false);
});

test("summarizes file statuses and both-side conflicts", () => {
  const stats = summarizeCompareFiles([
    { path: "a.ts", status: "added", additions: 10, deletions: 0, binary: false, gitlink: false, change_origin: "compare_only" },
    { path: "b.ts", status: "modified", additions: 3, deletions: 1, binary: false, gitlink: false, change_origin: "both" },
    { path: "c.ts", status: "type_changed", additions: 0, deletions: 0, binary: false, gitlink: false, change_origin: "base_only" },
    { path: "d.ts", status: "deleted", additions: 0, deletions: 5, binary: false, gitlink: false, change_origin: "both" },
    { path: "e.ts", status: "renamed", additions: 1, deletions: 1, binary: false, gitlink: false },
    { path: "f.ts", status: "copied", additions: 2, deletions: 0, binary: false, gitlink: false },
  ]);
  assert.deepEqual(stats, {
    total: 6,
    added: 1,
    modified: 2,
    deleted: 1,
    renamed: 2,
    bothCount: 2,
  });
});
