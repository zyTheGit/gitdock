import { ContextMenu, type MenuItem } from "../shared/ContextMenu";
import type { BranchMenuState, RowMenuState } from "./useCommitMenus";

interface AppMenusProps {
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  rowItems: MenuItem[];
  branchItems: MenuItem[];
  onRowClose: () => void;
  onBranchClose: () => void;
}

/** 提交行与分支右键菜单的统一挂载点：状态与条目仍由 App 组装，这里只负责渲染与关闭。 */
export function AppMenus({
  rowMenu,
  branchMenu,
  rowItems,
  branchItems,
  onRowClose,
  onBranchClose,
}: AppMenusProps) {
  return (
    <>
      {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowItems} onClose={onRowClose} />}
      {branchMenu && (
        <ContextMenu x={branchMenu.x} y={branchMenu.y} items={branchItems} onClose={onBranchClose} />
      )}
    </>
  );
}