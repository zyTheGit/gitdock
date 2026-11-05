import { ContextMenu, type MenuItem } from "../shared/ContextMenu";
import type { BranchMenuState, RowMenuState, TagMenuState } from "./useCommitMenus";

interface AppMenusProps {
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  tagMenu: TagMenuState | null;
  rowItems: MenuItem[];
  branchItems: MenuItem[];
  tagItems: MenuItem[];
  onRowClose: () => void;
  onBranchClose: () => void;
  onTagClose: () => void;
}

/** 提交行与分支/标签右键菜单的统一挂载点：状态与条目仍由 App 组装，这里只负责渲染与关闭。 */
export function AppMenus({
  rowMenu,
  branchMenu,
  tagMenu,
  rowItems,
  branchItems,
  tagItems,
  onRowClose,
  onBranchClose,
  onTagClose,
}: AppMenusProps) {
  return (
    <>
      {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowItems} onClose={onRowClose} />}
      {branchMenu && (
        <ContextMenu x={branchMenu.x} y={branchMenu.y} items={branchItems} onClose={onBranchClose} />
      )}
      {tagMenu && (
        <ContextMenu x={tagMenu.x} y={tagMenu.y} items={tagItems} onClose={onTagClose} />
      )}
    </>
  );
}