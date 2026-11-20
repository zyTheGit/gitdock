import { i18next } from "../../i18n";
import type { MenuItem } from "../../shared/ContextMenu";
import { openFileHistory, type FileHistoryOrigin } from "./fileHistoryTarget";

/**
 * 文件行右键菜单里的「查看文件历史 / 查看 Blame」两项：详情、对比与暂存区
 * 三个入口共用，避免文案与调用方式各写一份。
 */
export function fileHistoryMenuItems(
  path: string,
  oid: string,
  origin: FileHistoryOrigin,
): MenuItem[] {
  return [
    {
      label: i18next.t("history.viewFileHistory"),
      onSelect: () => openFileHistory({ path, oid, origin, tab: "history" }),
    },
    {
      label: i18next.t("history.viewFileBlame"),
      onSelect: () => openFileHistory({ path, oid, origin, tab: "blame" }),
    },
  ];
}
