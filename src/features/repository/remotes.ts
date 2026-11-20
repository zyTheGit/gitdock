import type { RefDto } from "../../shared/types";

/**
 * 远程相关的前端辅助（纯函数）：remote 名、缺省 remote 与检出预填的本地分支名。
 * 规则与后端 `remote::select_remote` / `remote::local_branch_name` 保持一致（ADR-0028），
 * 这里只做「预填与展示」，最终结论仍以 Gate 的 summary_args 为准。
 */

/** 从远程跟踪引用提取 remote 名（`origin/feat` → `origin`），去重排序。 */
export function remoteNamesFromRefs(refs: RefDto[]): string[] {
  const names = new Set<string>();
  for (const ref of refs) {
    if (ref.kind !== "remote_branch") {
      continue;
    }
    const slash = ref.short_name.indexOf("/");
    if (slash > 0) {
      names.add(ref.short_name.slice(0, slash));
    }
  }
  return [...names].sort();
}

/** 缺省 remote：有 origin 用 origin；唯一远程用它；多远程且无 origin 返回 null（要求用户选择）。 */
export function defaultRemote(remotes: string[]): string | null {
  if (remotes.includes("origin")) {
    return "origin";
  }
  return remotes.length === 1 ? remotes[0] : null;
}

/** `origin/feat-a` → `feat-a`：检出远程分支时预填的本地分支名。 */
export function suggestedLocalBranch(remoteBranch: string): string {
  const slash = remoteBranch.indexOf("/");
  return slash >= 0 ? remoteBranch.slice(slash + 1) : remoteBranch;
}
