import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { statusLabelKey } from "../../shared/fileStatus";
import { FileListModeToggle } from "../../shared/FileListModeToggle";
import { buildFileTree, flattenVisibleTree, type FileTreeRow } from "../../shared/fileTree";
import { useFileListMode } from "../../shared/useFileListMode";
import type { DiffFileEntry } from "./FileDiffView";

// 侧栏文件行高度初值（12px 文本 + 上下 padding + 2px 行间距）；文本行高随字体
// 而定，首帧后由 measureElement 按实际渲染高度（含行间距 padding）修正。
const EXPANDED_ROW_ESTIMATE = 28;
const EXPANDED_LIST_OVERSCAN = 12;

interface DiffFileSidebarProps {
  files: DiffFileEntry[];
  activePath: string;
  onSelectFile?: (path: string) => void;
  onFileContextMenu?: (event: MouseEvent<HTMLButtonElement>, path: string) => void;
}

/** 放大 diff 视图左侧的虚拟化文件清单栏（扁平 / 目录树双形态）。 */
export function DiffFileSidebar({
  files,
  activePath,
  onSelectFile,
  onFileContextMenu,
}: DiffFileSidebarProps) {
  const { t } = useI18n();
  const [listMode, setListMode] = useFileListMode();
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const sidebarTree = useMemo(() => buildFileTree(files), [files]);

  const sidebarRows = useMemo<FileTreeRow<DiffFileEntry>[]>(() => {
    if (listMode === "tree") {
      return flattenVisibleTree(sidebarTree, collapsedDirs);
    }
    return files.map((file) => ({
      kind: "file",
      key: `f:${file.path}`,
      path: file.path,
      name: file.path,
      depth: 0,
      item: file,
      dirPath: "",
    }));
  }, [listMode, sidebarTree, files, collapsedDirs]);

  const toggleDir = (path: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarVirtualizer = useVirtualizer({
    count: sidebarRows.length,
    getScrollElement: () => sidebarScrollRef.current,
    estimateSize: () => EXPANDED_ROW_ESTIMATE,
    overscan: EXPANDED_LIST_OVERSCAN,
    getItemKey: (index) => sidebarRows[index]?.key ?? index,
  });

  return (
    <aside className="expanded-files" aria-label={t("diff.changedFileList")}>
      <div className="expanded-files-head">
        <span>{t("diff.changedFiles")}</span>
        <span className="expanded-files-head-actions">
          <span className="muted">{files.length}</span>
          <FileListModeToggle mode={listMode} onChange={setListMode} />
        </span>
      </div>
      <div className="expanded-files-scroll" ref={sidebarScrollRef}>
        <ul
          className="expanded-files-inner"
          style={{ height: sidebarVirtualizer.getTotalSize() }}
        >
          {sidebarVirtualizer.getVirtualItems().map((item) => {
            const row = sidebarRows[item.index];
            if (!row) {
              return null;
            }
            return (
              <li
                key={item.key}
                data-index={item.index}
                ref={(node) => sidebarVirtualizer.measureElement(node)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {row.kind === "dir" ? (
                  <button
                    className="file-tree-dir"
                    style={{ paddingLeft: 6 + row.depth * 12 }}
                    aria-expanded={!collapsedDirs.has(row.path)}
                    onClick={() => toggleDir(row.path)}
                    title={row.path}
                  >
                    <Icon name="chevronDown" className="file-tree-chevron" />
                    <span className="file-tree-name">{row.name}</span>
                    <span className="file-tree-count">{row.fileCount}</span>
                  </button>
                ) : (
                  <button
                    className={row.item.path === activePath ? "active" : ""}
                    style={
                      listMode === "tree" ? { paddingLeft: 6 + row.depth * 12 } : undefined
                    }
                    onClick={() => onSelectFile?.(row.item.path)}
                    onContextMenu={(event) => {
                      if (!onFileContextMenu) {
                        return;
                      }
                      event.preventDefault();
                      onFileContextMenu(event, row.item.path);
                    }}
                    title={
                      onFileContextMenu
                        ? t("diff.fileContextMenuHint", { path: row.item.path })
                        : row.item.path
                    }
                    aria-current={row.item.path === activePath ? "true" : undefined}
                  >
                    <span className={`file-status file-status-${row.item.status}`}>
                      {t(statusLabelKey(row.item.status))}
                    </span>
                    <span className="file-path">{row.name}</span>
                    <span className="file-stats">
                      <span className="diff-add">+{row.item.additions}</span>
                      <span className="diff-del">-{row.item.deletions}</span>
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
