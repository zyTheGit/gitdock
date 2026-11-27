import type { RecentRepository } from "../../shared/types";

export interface RepositoryEntry {
  key: string;
  path: string;
  name: string;
  current: boolean;
}

export interface RepositoryGroup {
  kind: "current" | "recent";
  entries: RepositoryEntry[];
}

/** 统一路径分隔符与大小写，沿用最近仓库已有的跨平台比较口径。 */
export function normalizeRepositoryPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function repositoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 打开仓库弹层的当前项与最近项；当前仓库从最近项中排除。 */
export function buildRepositoryGroups(
  currentPath: string | null,
  recent: RecentRepository[],
  query: string,
): RepositoryGroup[] {
  const needle = normalizeRepositoryPath(query.trim());
  const matches = (path: string) =>
    !needle ||
    normalizeRepositoryPath(path).includes(needle) ||
    repositoryName(path).toLowerCase().includes(needle);
  const current: RepositoryEntry[] =
    currentPath && matches(currentPath)
      ? [{ key: "current", path: currentPath, name: repositoryName(currentPath), current: true }]
      : [];
  const recentEntries: RepositoryEntry[] = recent
    .filter((entry) => !currentPath || normalizeRepositoryPath(entry.path) !== normalizeRepositoryPath(currentPath))
    .filter((entry) => matches(entry.path))
    .map((entry) => ({
      key: normalizeRepositoryPath(entry.path),
      path: entry.path,
      name: repositoryName(entry.path),
      current: false,
    }));

  const groups: RepositoryGroup[] = [
    { kind: "current", entries: current },
    { kind: "recent", entries: recentEntries },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

/** ↑↓ 在仓库列表内循环；空列表保持 0。 */
export function moveRepositorySelection(index: number, delta: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return (index + delta + count) % count;
}
