import { useCallback } from "react";
import { useI18n } from "../../i18n";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { copyText } from "../../shared/clipboard";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { fileHistoryMenuItems } from "../history/menuItems";
import type { Side } from "./StagingFileList";

interface StagingFileMenuProps {
  x: number;
  y: number;
  side: Side;
  /** 仓库内相对路径（后端只接受相对路径，绝对路径与 .. 会被拒绝）。 */
  path: string;
  /** 当前 HEAD 提交；HEAD 未出生时为 null，历史与 Blame 无从计算。 */
  headOid: string | null;
  /** 写互斥/加载中时禁用 stage/unstage 一项。 */
  writeDisabled: boolean;
  onClose: () => void;
  onMutate: (side: Side, paths: string[]) => void;
  /** 丢弃该文件的未暂存改动（破坏性）；仅未暂存一侧提供。 */
  onDiscard?: (paths: string[]) => void;
  onError: (message: string) => void;
}

/** 暂存区文件行右键菜单：暂存/取消暂存、丢弃未暂存改动、文件历史/Blame、复制路径、在文件管理器中显示。 */
export function StagingFileMenu({
  x,
  y,
  side,
  path,
  headOid,
  writeDisabled,
  onClose,
  onMutate,
  onDiscard,
  onError,
}: StagingFileMenuProps) {
  const { t } = useI18n();

  const reveal = useCallback(async () => {
    try {
      await ipc.revealInFileManager(path);
    } catch (err) {
      onError(errorText(err));
    }
  }, [onError, path]);

  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        {
          label: side === "unstaged" ? t("staging.actionStage") : t("staging.actionUnstage"),
          disabled: writeDisabled,
          onSelect: () => onMutate(side, [path]),
        },
        ...(onDiscard
          ? [
              {
                label: t("staging.actionDiscard"),
                disabled: writeDisabled,
                onSelect: () => onDiscard([path]),
              },
            ]
          : []),
        ...(headOid
          ? fileHistoryMenuItems(path, headOid, "staging")
          : [
              {
                label: t("history.noHeadCommit"),
                disabled: true,
                onSelect: () => undefined,
              } satisfies MenuItem,
            ]),
        {
          label: t("staging.copyRelativePath"),
          onSelect: () => void copyText(path),
        },
        {
          label: t("staging.revealInFileManager"),
          onSelect: () => void reveal(),
        },
      ]}
    />
  );
}
