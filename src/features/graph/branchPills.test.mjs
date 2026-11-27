import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchPills } from "./branchPills.ts";

test("merges matching remote branches into local pills and keeps remote-only pills", () => {
  const group = buildBranchPills(
    ["develop", "main"],
    ["origin/develop", "upstream/develop", "origin/fix/typo"],
  );
  assert.equal(group.omitted, 0);
  assert.deepEqual(group.pills, [
    { key: "l:develop", name: "develop", remotes: ["origin", "upstream"] },
    { key: "l:main", name: "main", remotes: [] },
    { key: "r:origin/fix/typo", name: "origin/fix/typo", remotes: [] },
  ]);
});

test("truncates pills beyond maxPills and reports omitted count", () => {
  const group = buildBranchPills(
    ["b1", "b2", "b3"],
    ["origin/b4", "origin/b5"],
    4,
  );
  assert.equal(group.pills.length, 4);
  assert.equal(group.omitted, 1);
});
