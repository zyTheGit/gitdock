import { DiscardConfirmDialog } from "./DiscardConfirmDialog";
import { HunkDiscardConfirmDialog } from "./HunkDiscardConfirmDialog";
import { StagingFileMenu } from "./StagingFileMenu";
import type { Side } from "./StagingFileList";
import type { StagingStatusDto } from "../../shared/types";
import type { DiscardFlow } from "./useDiscardFlow";
import type { HunkFlow } from "./useHunkFlow";

/** 文件行右键菜单：位置与目标文件（列别 + 仓库内相对路径）。 */
export interface FileMenuState {
  x: number;
  y: number;
  side: Side;
  path: string;
}

interface StagingDialogsProps {
  menu: FileMenuState | null;
  status: StagingStatusDto | null;
  /** 当前 HEAD 提交；HEAD 未出生时为 null。 */
  headOid: string | null;
  writeDisabled: boolean;
  onCloseMenu: () => void;
  onMutate: (side: Side, paths: string[]) => void;
  onOpenDiscard: (paths: string[]) => void;
  onError: (message: string) => void;
  discard: DiscardFlow;
  hunk: HunkFlow;
  onOpenStash: () => void;
}

/** 暂存区的浮层集合：文件右键菜单、丢弃确认框、hunk 丢弃确认框。 */
export function StagingDialogs({
  menu,
  status,
  headOid,
  writeDisabled,
  onCloseMenu,
  onMutate,
  onOpenDiscard,
  onError,
  discard,
  hunk,
  onOpenStash,
}: StagingDialogsProps) {
  const discardPending = discard.pending;
  // 确认框里区分「回退」与「删除」两类动作，仅起提示作用（路径性质仍由后端判定）。
  const discardUntracked = discardPending
    ? (status?.unstaged ?? [])
        .filter((file) => file.untracked && discardPending.includes(file.path))
        .map((file) => file.path)
    : [];

  return (
    <>
      {menu && (
        <StagingFileMenu
          x={menu.x}
          y={menu.y}
          side={menu.side}
          path={menu.path}
          headOid={headOid}
          writeDisabled={writeDisabled}
          onClose={onCloseMenu}
          onMutate={onMutate}
          onDiscard={menu.side === "unstaged" ? onOpenDiscard : undefined}
          onError={onError}
        />
      )}

      {discardPending && (
        <DiscardConfirmDialog
          paths={discardPending}
          untrackedPaths={discardUntracked}
          gate={discard.gate}
          issues={discard.issues}
          error={discard.error}
          validating={discard.validating}
          busy={discard.busy}
          onCancel={discard.cancel}
          onConfirm={() => void discard.confirm()}
          onOpenStash={() => {
            discard.cancel();
            onOpenStash();
          }}
        />
      )}

      {hunk.confirmingDiscard && (
        <HunkDiscardConfirmDialog
          path={hunk.confirmingDiscard.path}
          ordinal={hunk.confirmingDiscard.ordinal}
          total={hunk.confirmingDiscard.total}
          issues={hunk.gateIssues}
          warnings={hunk.gateWarnings}
          error={hunk.discardError}
          validating={hunk.discardValidating}
          busy={hunk.discardBusy}
          onCancel={hunk.cancelDiscard}
          onConfirm={() => void hunk.confirmDiscard()}
          onOpenStash={() => {
            hunk.cancelDiscard();
            onOpenStash();
          }}
        />
      )}
    </>
  );
}
