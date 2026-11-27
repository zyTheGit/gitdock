import assert from "node:assert/strict";
import test from "node:test";
import { searchCommandItems } from "./commandSearch.ts";

const items = Object.freeze([
  Object.freeze({
    id: "commit",
    title: "Commit changes",
    context: "Staging",
    shortcut: "Ctrl+Enter",
    keywords: "record save action",
  }),
  Object.freeze({
    id: "branch",
    title: "Create branch",
    context: "Repository",
    keywords: "new ref action",
    disabledReason: "No repository open",
  }),
  Object.freeze({
    id: "history",
    title: "查看文件历史",
    context: "当前提交",
    keywords: "日志 blame action",
  }),
  Object.freeze({
    id: "push",
    title: "Push",
    context: "Remote",
    shortcut: "Ctrl+Shift+P",
    keywords: "upload action",
  }),
]);

function ids(results) {
  return results.map((item) => item.id);
}

test("returns all items for empty and whitespace-only queries", () => {
  for (const query of ["", " ", "\t\n"]) {
    assert.deepEqual(searchCommandItems(items, query), items);
  }
  assert.deepEqual(searchCommandItems([], ""), []);
});

test("matches Chinese substrings", () => {
  assert.deepEqual(ids(searchCommandItems(items, "历史")), ["history"]);
  assert.deepEqual(ids(searchCommandItems(items, "当前")), ["history"]);
  assert.deepEqual(ids(searchCommandItems(items, "日志")), ["history"]);
});

test("matches English case-insensitively and trims the query", () => {
  assert.deepEqual(ids(searchCommandItems(items, "cOmMiT")), ["commit"]);
  assert.deepEqual(ids(searchCommandItems(items, "  PUSH \n")), ["push"]);
});

test("searches context and keywords", () => {
  assert.deepEqual(ids(searchCommandItems(items, "stagING")), ["commit"]);
  assert.deepEqual(ids(searchCommandItems(items, "remote")), ["push"]);
  assert.deepEqual(ids(searchCommandItems(items, "SAVE")), ["commit"]);
  assert.deepEqual(ids(searchCommandItems(items, "new ref")), ["branch"]);
});

test("preserves catalog order without ranking", () => {
  assert.deepEqual(ids(searchCommandItems(items, "action")), [
    "commit",
    "branch",
    "history",
    "push",
  ]);
});

test("retains disabled items and their reasons", () => {
  const matches = searchCommandItems(items, "Repository");
  assert.deepEqual(ids(matches), ["branch"]);
  assert.equal(matches[0], items[1]);
  assert.equal(matches[0].disabledReason, "No repository open");
  assert.deepEqual(ids(searchCommandItems(items, "")), [
    "commit",
    "branch",
    "history",
    "push",
  ]);
});

test("uses substring matching rather than fuzzy matching", () => {
  assert.deepEqual(ids(searchCommandItems(items, "mit")), ["commit"]);
  assert.deepEqual(searchCommandItems(items, "cmt chgs"), []);
  assert.deepEqual(searchCommandItems(items, "不存在的命令"), []);
});
