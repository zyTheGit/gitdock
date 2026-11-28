import assert from "node:assert/strict";
import test from "node:test";
import { selectCommitRange, toggleCommitSelection } from "./commitSelection.ts";

const ORDER = ["c1", "c2", "c3", "c4", "c5"];

test("direct point-select adds and removes non-contiguous commits in click order", () => {
  let state = { oids: [], anchor: "c1" };
  state = toggleCommitSelection(state, "c4", ORDER, { includeAnchor: false });
  assert.deepEqual(state, { oids: ["c4"], anchor: "c4" });

  state = toggleCommitSelection(state, "c2", ORDER, { includeAnchor: false });
  assert.deepEqual(state, { oids: ["c4", "c2"], anchor: "c2" });

  state = toggleCommitSelection(state, "c4", ORDER, { includeAnchor: false });
  assert.deepEqual(state, { oids: ["c2"], anchor: "c2" });

  // 移除当前锚点时，锚点回退到剩余最后一个选中项。
  state = toggleCommitSelection(state, "c2", ORDER, { includeAnchor: false });
  assert.deepEqual(state, { oids: [], anchor: null });
});

test("Alt+click seeds selection from existing plain-click anchor", () => {
  let state = { oids: [], anchor: "c1" };
  state = toggleCommitSelection(state, "c3", ORDER, { includeAnchor: true });
  assert.deepEqual(state, { oids: ["c1", "c3"], anchor: "c3" });

  // 锚点就是目标自身时不重复加入。
  const same = toggleCommitSelection({ oids: [], anchor: "c2" }, "c2", ORDER, {
    includeAnchor: true,
  });
  assert.deepEqual(same, { oids: ["c2"], anchor: "c2" });
});

test("Shift range selection supports forward, reverse, and continuation after point-select", () => {
  const forward = selectCommitRange({ oids: [], anchor: "c2" }, "c4", ORDER);
  assert.deepEqual(forward, { oids: ["c2", "c3", "c4"], anchor: "c2" });

  const reverse = selectCommitRange({ oids: [], anchor: "c4" }, "c2", ORDER);
  assert.deepEqual(reverse, { oids: ["c4", "c3", "c2"], anchor: "c4" });

  // 先点选 c1 再点选 c3，随后 Shift+点击 c5，应从最后点选的 c3 延伸到 c5。
  let mixed = { oids: [], anchor: null };
  mixed = toggleCommitSelection(mixed, "c1", ORDER);
  mixed = toggleCommitSelection(mixed, "c3", ORDER);
  mixed = selectCommitRange(mixed, "c5", ORDER);
  assert.deepEqual(mixed, { oids: ["c1", "c3", "c4", "c5"], anchor: "c3" });
});
