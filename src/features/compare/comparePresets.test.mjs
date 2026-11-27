import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARE_PRESET_SCHEMA_VERSION,
  addComparePreset,
  comparePresetStorageKey,
  createComparePreset,
  deleteComparePreset,
  isCommitOid,
  parseComparePresets,
  readComparePresets,
  removeComparePreset,
  serializeComparePresets,
  writeComparePresets,
} from "./comparePresets.ts";

const BASE_OID = "0123456789abcdef0123456789abcdef01234567";
const COMPARE_OID = "fedcba9876543210fedcba9876543210fedcba98";

function preset(overrides = {}) {
  return {
    id: "preset-1",
    name: "Release candidate",
    base: { oid: BASE_OID, label: "main" },
    compare: { oid: COMPARE_OID, label: "release" },
    createdAt: 1_800_000_000_000,
    ...overrides,
  };
}

function envelope(presets, schemaVersion = COMPARE_PRESET_SCHEMA_VERSION) {
  return JSON.stringify({ schemaVersion, presets });
}

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("accepts SHA-1 and SHA-256 commit OIDs only", () => {
  assert.equal(isCommitOid(BASE_OID), true);
  assert.equal(isCommitOid("a".repeat(64)), true);
  assert.equal(isCommitOid("A".repeat(40)), true);
  for (const invalid of ["worktree", "abc123", "g".repeat(40), `${BASE_OID} `, 42, null]) {
    assert.equal(isCommitOid(invalid), false);
  }
});

test("parses the versioned envelope, trims names and normalizes OID case", () => {
  const parsed = parseComparePresets(
    envelope([preset({ name: "  Release candidate  ", base: { oid: BASE_OID.toUpperCase(), label: "main" } })]),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Release candidate");
  assert.equal(parsed[0].base.oid, BASE_OID);
  assert.equal(parsed[0].compare.label, "release");
  assert.equal(parsed[0].createdAt, 1_800_000_000_000);
});

test("ignores malformed, incompatible and non-array storage safely", () => {
  for (const raw of [
    null,
    "{not json",
    "null",
    "[]",
    JSON.stringify({ schemaVersion: 2, presets: [] }),
    JSON.stringify({ schemaVersion: 1, presets: {} }),
    JSON.stringify({ presets: [] }),
  ]) {
    assert.deepEqual(parseComparePresets(raw), []);
  }
});

test("rejects invalid names, labels, IDs, timestamps and duplicate IDs", () => {
  const invalidPresets = [
    preset({ name: "   " }),
    preset({ name: 7 }),
    preset({ name: "x".repeat(121) }),
    preset({ base: { oid: BASE_OID, label: 7 } }),
    preset({ compare: { oid: "worktree", label: "Working tree" } }),
    preset({ compare: { oid: "abc123", label: "release" } }),
    preset({ id: "" }),
    preset({ createdAt: 0 }),
    preset({ createdAt: 1.5 }),
    preset({ createdAt: "1800000000000" }),
    preset({ createdAt: 8_640_000_000_000_001 }),
  ];
  for (const invalid of invalidPresets) {
    assert.deepEqual(parseComparePresets(envelope([invalid])), []);
  }
  assert.deepEqual(parseComparePresets(envelope([preset(), preset()])), []);
  assert.deepEqual(parseComparePresets(envelope([preset(), preset({ id: "broken", name: "" })])), []);
});

test("creates normalized snapshots and refuses blank names or invalid endpoints", () => {
  const created = createComparePreset(
    {
      name: "  Hotfix compare  ",
      base: { oid: BASE_OID, label: "main" },
      compare: { oid: COMPARE_OID, label: "hotfix" },
    },
    "new-id",
    1_800_000_000_001,
  );
  assert.equal(created?.name, "Hotfix compare");
  assert.equal(created?.id, "new-id");
  assert.equal(
    createComparePreset(
      { name: " ", base: { oid: BASE_OID, label: "main" }, compare: { oid: COMPARE_OID, label: "release" } },
      "new-id",
      1,
    ),
    null,
  );
  assert.equal(
    createComparePreset(
      { name: "Bad", base: { oid: "worktree", label: "Working tree" }, compare: { oid: COMPARE_OID, label: "release" } },
      "new-id",
      1,
    ),
    null,
  );
});

test("encodes repository paths and isolates persisted presets", () => {
  const storage = new MemoryStorage();
  const firstPath = "C:\\repos\\Git Dock";
  const secondPath = "C:/repos/对比";
  const firstKey = comparePresetStorageKey(firstPath);
  const secondKey = comparePresetStorageKey(secondPath);
  assert.equal(firstKey, `gitdock.compare-presets.v1:${encodeURIComponent(firstPath)}`);
  assert.notEqual(firstKey, secondKey);

  const saved = [preset()];
  assert.equal(writeComparePresets(storage, firstPath, saved), true);
  assert.equal(writeComparePresets(storage, secondPath, [preset({ id: "preset-2" })]), true);
  assert.deepEqual(readComparePresets(storage, firstPath), saved);
  assert.equal(readComparePresets(storage, secondPath)[0].id, "preset-2");
  assert.equal(readComparePresets(new MemoryStorage(), firstPath).length, 0);
});

test("round-trips add/remove transforms without mutating the input", () => {
  const original = [preset()];
  const next = preset({ id: "preset-2", name: "Second" });
  const added = addComparePreset(original, next);
  assert.equal(original.length, 1);
  assert.equal(added.length, 2);
  assert.deepEqual(removeComparePreset(added, "preset-1"), [next]);
  assert.deepEqual(removeComparePreset(added, "missing"), added);
  assert.deepEqual(parseComparePresets(serializeComparePresets(added)), added);
});

test("deletes one preset, preserves other repositories and removes an empty key", () => {
  const storage = new MemoryStorage();
  const path = "/repo";
  const key = comparePresetStorageKey(path);
  const first = preset();
  const second = preset({ id: "preset-2", name: "Second" });
  writeComparePresets(storage, path, [first, second]);
  writeComparePresets(storage, "/other", [preset({ id: "other" })]);

  assert.equal(deleteComparePreset(storage, path, "preset-1"), true);
  assert.deepEqual(readComparePresets(storage, path), [second]);
  assert.equal(readComparePresets(storage, "/other")[0].id, "other");
  assert.equal(deleteComparePreset(storage, path, "missing"), true);
  assert.equal(deleteComparePreset(storage, path, "preset-2"), true);
  assert.equal(storage.getItem(key), null);
});

test("contains localStorage read and write failures", () => {
  const unreadable = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {},
    removeItem() {},
  };
  const unwritable = {
    getItem() {
      return envelope([preset()]);
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.deepEqual(readComparePresets(unreadable, "/repo"), []);
  assert.equal(writeComparePresets(unwritable, "/repo", [preset()]), false);
  assert.equal(deleteComparePreset(unwritable, "/repo", "preset-1"), false);
  assert.deepEqual(readComparePresets(null, "/repo"), []);
});
