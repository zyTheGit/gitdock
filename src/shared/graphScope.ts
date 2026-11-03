import type { GraphScope } from "./types";

/** 把图谱范围折叠成稳定字符串键：effect 依赖数组与各 loader 的范围比较共用。 */
export function scopeKey(scope: GraphScope): string {
  return scope.kind === "branch" ? `branch:${scope.value}` : scope.kind;
}