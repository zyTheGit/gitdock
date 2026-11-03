import { useEffect, useState } from "react";
import { ipc } from "../../shared/ipc";
import { useIpcResource } from "../../shared/useIpcResource";
import type { CommitDetailDto, FileDiffDto } from "../../shared/types";

export interface DetailLoader<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// generation 参与依赖：仓库刷新后旧请求结果无法覆盖新视图。
export function useCommitDetail(
  oid: string | null,
  generation: number,
): DetailLoader<CommitDetailDto> {
  return useIpcResource(
    [oid],
    () => ipc.readCommit(oid!),
    { enabled: oid !== null, expectedGeneration: generation },
  );
}

export function useBranchesContaining(oid: string | null, generation: number): string[] {
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    setBranches([]);
    if (!oid) {
      return;
    }
    let cancelled = false;
    ipc
      .branchesContaining(oid)
      .then((names) => {
        if (!cancelled) {
          setBranches(names);
        }
      })
      .catch(() => {
        // 分支归属只是辅助信息，查询失败不影响详情主体。
      });
    return () => {
      cancelled = true;
    };
  }, [oid, generation]);

  return branches;
}

export function useFileDiff(
  oid: string | null,
  path: string | null,
  generation: number,
): DetailLoader<FileDiffDto> {
  return useIpcResource(
    [oid, path],
    () => ipc.readFileDiff(oid!, path!),
    { enabled: oid !== null && path !== null, expectedGeneration: generation },
  );
}
