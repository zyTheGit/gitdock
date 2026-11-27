import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckoutRemoteBranchDialog } from "../features/repository/CheckoutRemoteBranchDialog";
import { CreateBranchDialog } from "../features/repository/CreateBranchDialog";
import { CreateTagDialog } from "../features/repository/CreateTagDialog";
import { DeleteRefDialog, type DeleteKind } from "../features/repository/DeleteRefDialog";
import { PushTagDialog } from "../features/repository/PushTagDialog";
import { RenameBranchDialog } from "../features/repository/RenameBranchDialog";
import { remoteNamesFromRefs } from "../features/repository/remotes";
import type { CommitSummaryDto, RefDto, RepoStateDto } from "../shared/types";

interface UseRefActionsParams {
  repo: RepoStateDto | null;
  writeDisabled: boolean;
  onMutated: (message: string) => Promise<void>;
}

interface DeleteTarget {
  kind: DeleteKind;
  name: string;
  /** 分支删除时同时删除远程同名分支（ADR 0022）；两段执行由 DeleteRefDialog 处理。 */
  remote?: boolean;
}

/**
 * 分支/标签写操作的入口与对话框状态（ADR 0008）：入口由侧栏和右键菜单触发，
 * 对话框统一挂在 App 底部，写后刷新复用 onMutated 的 generation 通道。
 */
export function useRefActions({ repo, writeDisabled, onMutated }: UseRefActionsParams) {
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [createBranchStart, setCreateBranchStart] = useState<CommitSummaryDto | null>(null);
  const [renameBranch, setRenameBranch] = useState<string | null>(null);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [createTagStart, setCreateTagStart] = useState<CommitSummaryDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [checkoutRemote, setCheckoutRemote] = useState<string | null>(null);
  const [pushTag, setPushTag] = useState<string | null>(null);

  const repoPath = repo?.path ?? null;
  useEffect(() => {
    setCreateBranchOpen(false);
    setCreateBranchStart(null);
    setRenameBranch(null);
    setCreateTagOpen(false);
    setCreateTagStart(null);
    setDeleteTarget(null);
    setCheckoutRemote(null);
    setPushTag(null);
  }, [repoPath]);

  const available = Boolean(repo) && !writeDisabled;
  const localBranches = useMemo(
    () =>
      (repo?.refs ?? [])
        .filter((ref) => ref.kind === "local_branch")
        .map((ref) => ref.short_name),
    [repo?.refs],
  );
  const remoteNames = useMemo(() => remoteNamesFromRefs(repo?.refs ?? []), [repo?.refs]);

  const openCreateBranch = useCallback(
    (commit?: CommitSummaryDto) => {
      if (!available) {
        return;
      }
      setCreateBranchStart(commit ?? null);
      setCreateBranchOpen(true);
    },
    [available],
  );

  const openRenameBranch = useCallback(
    (branch: string) => {
      if (available) {
        setRenameBranch(branch);
      }
    },
    [available],
  );

  const openCreateTag = useCallback(
    (commit?: CommitSummaryDto) => {
      if (!available) {
        return;
      }
      setCreateTagStart(commit ?? null);
      setCreateTagOpen(true);
    },
    [available],
  );

  const openDeleteBranch = useCallback(
    (name: string) => {
      if (available) {
        setDeleteTarget({ kind: "delete_branch", name });
      }
    },
    [available],
  );

  const openDeleteBranchRemote = useCallback(
    (name: string) => {
      if (available) {
        setDeleteTarget({ kind: "delete_branch", name, remote: true });
      }
    },
    [available],
  );

  const openDeleteTag = useCallback(
    (name: string) => {
      if (available) {
        setDeleteTarget({ kind: "delete_tag", name });
      }
    },
    [available],
  );

  const openDeleteTagRemote = useCallback(
    (name: string) => {
      if (available) {
        setDeleteTarget({ kind: "delete_tag", name, remote: true });
      }
    },
    [available],
  );

  /** 远程分支短名（`origin/feat-a`）：检出为本地跟踪分支前先确认（ADR-0028）。 */
  const openCheckoutRemote = useCallback(
    (remoteBranch: string) => {
      if (available) {
        setCheckoutRemote(remoteBranch);
      }
    },
    [available],
  );

  const openPushTag = useCallback(
    (tag: string) => {
      if (available) {
        setPushTag(tag);
      }
    },
    [available],
  );

  const dialogs = (
    <>
      {repo && createBranchOpen && (
        <CreateBranchDialog
          start={createBranchStart}
          hasHead={Boolean(repo.head.oid)}
          onCancel={() => setCreateBranchOpen(false)}
          onMutated={onMutated}
        />
      )}
      {repo && renameBranch !== null && (
        <RenameBranchDialog
          branch={renameBranch}
          onCancel={() => setRenameBranch(null)}
          onMutated={onMutated}
        />
      )}
      {repo && createTagOpen && (
        <CreateTagDialog
          start={createTagStart}
          hasHead={Boolean(repo.head.oid)}
          onCancel={() => setCreateTagOpen(false)}
          onMutated={onMutated}
        />
      )}
      {repo && deleteTarget !== null && (
        <DeleteRefDialog
          kind={deleteTarget.kind}
          name={deleteTarget.name}
          remote={deleteTarget.remote}
          onCancel={() => setDeleteTarget(null)}
          onMutated={onMutated}
        />
      )}
      {repo && checkoutRemote !== null && (
        <CheckoutRemoteBranchDialog
          remoteBranch={checkoutRemote}
          localBranches={localBranches}
          onCancel={() => setCheckoutRemote(null)}
          onMutated={onMutated}
        />
      )}
      {repo && pushTag !== null && (
        <PushTagDialog
          tag={pushTag}
          remotes={remoteNames}
          onCancel={() => setPushTag(null)}
          onMutated={onMutated}
        />
      )}
    </>
  );

  return {
    openCreateBranch,
    openRenameBranch,
    openCreateTag,
    openDeleteBranch,
    openDeleteBranchRemote,
    openDeleteTag,
    openDeleteTagRemote,
    openCheckoutRemote,
    openPushTag,
    menuActions: {
      onNewBranch: openCreateBranch,
      onNewTag: openCreateTag,
      onRenameBranch: openRenameBranch,
      onDeleteBranch: openDeleteBranch,
      onDeleteBranchRemote: openDeleteBranchRemote,
      onDeleteTagRemote: openDeleteTagRemote,
      onCheckoutRemote: (branch: RefDto) => openCheckoutRemote(branch.short_name),
      onPushTag: (tag: RefDto) => openPushTag(tag.short_name),
    },
    dialogs,
  };
}