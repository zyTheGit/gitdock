export interface BranchPill {
  key: string;
  name: string;
  remotes: string[];
}

export interface BranchPillGroup {
  pills: BranchPill[];
  omitted: number;
}

/**
 * 将本地分支与远程分支合并为紧凑胶囊列表：
 * 同名远程分支（如 `origin/develop`）并入本地 `develop` 的右侧分段，仅远端存在的分支独立成枚。
 */
export function buildBranchPills(
  branches: readonly string[],
  remoteBranches: readonly string[],
  maxPills = 8,
): BranchPillGroup {
  const localMap = new Map<string, BranchPill>();
  const all: BranchPill[] = [];

  for (const name of branches) {
    const pill: BranchPill = { key: `l:${name}`, name, remotes: [] };
    localMap.set(name, pill);
    all.push(pill);
  }

  for (const remote of remoteBranches) {
    const slash = remote.indexOf("/");
    if (slash > 0) {
      const remoteName = remote.slice(0, slash);
      const branchName = remote.slice(slash + 1);
      const local = localMap.get(branchName);
      if (local) {
        if (!local.remotes.includes(remoteName)) {
          local.remotes.push(remoteName);
        }
        continue;
      }
    }
    all.push({ key: `r:${remote}`, name: remote, remotes: [] });
  }

  return {
    pills: all.slice(0, maxPills),
    omitted: Math.max(0, all.length - maxPills),
  };
}
