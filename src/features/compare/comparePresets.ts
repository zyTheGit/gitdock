export const COMPARE_PRESET_SCHEMA_VERSION = 1 as const;
export const COMPARE_PRESET_STORAGE_PREFIX = "gitdock.compare-presets";

export interface ComparePresetEndpoint {
  oid: string;
  label: string;
}

export interface ComparePreset {
  id: string;
  name: string;
  base: ComparePresetEndpoint;
  compare: ComparePresetEndpoint;
  createdAt: number;
}

export interface NewComparePreset {
  name: string;
  base: ComparePresetEndpoint;
  compare: ComparePresetEndpoint;
}

export interface ComparePresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PresetEnvelope {
  schemaVersion: typeof COMPARE_PRESET_SCHEMA_VERSION;
  presets: ComparePreset[];
}

const COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function isCommitOid(value: unknown): value is string {
  return typeof value === "string" && COMMIT_OID.test(value);
}

/** 仓库路径整体编码，避免分隔符、盘符与 Unicode 造成键冲突。 */
export function comparePresetStorageKey(repoPath: string): string {
  return `${COMPARE_PRESET_STORAGE_PREFIX}.v${COMPARE_PRESET_SCHEMA_VERSION}:${encodeURIComponent(repoPath)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value
    : null;
}

function parseEndpoint(value: unknown): ComparePresetEndpoint | null {
  const endpoint = record(value);
  if (!endpoint || !isCommitOid(endpoint.oid)) {
    return null;
  }
  const label = text(endpoint.label, 256);
  return label ? { oid: endpoint.oid.toLowerCase(), label } : null;
}

function parsePreset(value: unknown): ComparePreset | null {
  const preset = record(value);
  if (!preset) {
    return null;
  }
  const id = text(preset.id, 128);
  const name = text(preset.name, 120);
  const base = parseEndpoint(preset.base);
  const compare = parseEndpoint(preset.compare);
  const createdAt = preset.createdAt;
  if (
    !id ||
    !name ||
    !base ||
    !compare ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    createdAt > 8_640_000_000_000_000
  ) {
    return null;
  }
  return { id, name: name.trim(), base, compare, createdAt };
}

/** 任一记录损坏即忽略整份数据，避免呈现来源混杂的半兼容方案。 */
export function parseComparePresets(raw: string | null): ComparePreset[] {
  if (raw === null) {
    return [];
  }
  try {
    const envelope = record(JSON.parse(raw) as unknown);
    if (
      !envelope ||
      envelope.schemaVersion !== COMPARE_PRESET_SCHEMA_VERSION ||
      !Array.isArray(envelope.presets)
    ) {
      return [];
    }
    const parsed = envelope.presets.map(parsePreset);
    if (parsed.some((preset) => preset === null)) {
      return [];
    }
    const presets = parsed.filter((preset): preset is ComparePreset => preset !== null);
    return new Set(presets.map((preset) => preset.id)).size === presets.length ? presets : [];
  } catch {
    return [];
  }
}

export function serializeComparePresets(presets: ComparePreset[]): string {
  const envelope: PresetEnvelope = {
    schemaVersion: COMPARE_PRESET_SCHEMA_VERSION,
    presets,
  };
  return JSON.stringify(envelope);
}

export function createComparePreset(
  input: NewComparePreset,
  id: string,
  createdAt: number,
): ComparePreset | null {
  return parsePreset({ ...input, id, createdAt });
}

export function addComparePreset(
  presets: ComparePreset[],
  preset: ComparePreset,
): ComparePreset[] {
  return [...presets, preset];
}

export function removeComparePreset(
  presets: ComparePreset[],
  id: string,
): ComparePreset[] {
  return presets.filter((preset) => preset.id !== id);
}

export function readComparePresets(
  storage: ComparePresetStorage | null,
  repoPath: string,
): ComparePreset[] {
  if (!storage || !repoPath) {
    return [];
  }
  try {
    return parseComparePresets(storage.getItem(comparePresetStorageKey(repoPath)));
  } catch {
    return [];
  }
}

export function writeComparePresets(
  storage: ComparePresetStorage | null,
  repoPath: string,
  presets: ComparePreset[],
): boolean {
  if (!storage || !repoPath) {
    return false;
  }
  try {
    storage.setItem(comparePresetStorageKey(repoPath), serializeComparePresets(presets));
    return true;
  } catch {
    return false;
  }
}

export function deleteComparePreset(
  storage: ComparePresetStorage | null,
  repoPath: string,
  id: string,
): boolean {
  if (!storage || !repoPath) {
    return false;
  }
  try {
    const key = comparePresetStorageKey(repoPath);
    const current = parseComparePresets(storage.getItem(key));
    const next = removeComparePreset(current, id);
    if (next.length === current.length) {
      return true;
    }
    if (next.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, serializeComparePresets(next));
    }
    return true;
  } catch {
    return false;
  }
}
