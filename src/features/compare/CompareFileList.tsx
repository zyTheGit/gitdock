import { useMemo, useState, type MouseEvent } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { FileListModeToggle } from "../../shared/FileListModeToggle";
import { buildFileTree, flattenVisibleTree, type FileTreeRow } from "../../shared/fileTree";
import { STATUS_LETTER } from "../../shared/fileStatus";
import type { ChangedFileDto } from "../../shared/types";
import { useFileListMode } from "../../shared/useFileListMode";

interface CompareFileListProps {
  files: ChangedFileDto[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
}

function fullLabel(file: ChangedFileDto): string {
  return file.old_path && file.old_path !== file.path
    ? `${file.old_path} → ${file.path}`
    : file.path;
}

/** 对比视图文件列表：扁平 / 目录树两种形态，共用同一批文件 DTO。 */
export function CompareFileList({
  files,
  activePath,
  onSelect,
  onContextMenu,
}: CompareFileListProps) {
  const { t } = useI18n();
  const [mode, setMode] = useFileListMode();
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const tree = useMemo(() => buildFileTree(files), [files]);
  const rows = useMemo<FileTreeRow<ChangedFileDto>[]>(() => {
    if (mode === "tree") {
      return flattenVisibleTree(tree, collapsedDirs);
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
  }, [mode, tree, files, collapsedDirs]);

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

  return (
    <div className="detail-files">
      <div className="detail-files-head">
        <h3>{t("compare.changedFiles", { n: files.length })}</h3>
        {files.length > 0 && <FileListModeToggle mode={mode} onChange={setMode} />}
      </div>
      {files.length === 0 ? (
        <p className="muted">{t("compare.noFileChanges")}</p>
      ) : (
        <ul className="file-list compare-file-list">
          {rows.map((row) =>
            row.kind === "dir" ? (
              <li key={row.key}>
                <button
                  className="file-tree-dir"
                  style={{ paddingLeft: 4 + row.depth * 12 }}
                  aria-expanded={!collapsedDirs.has(row.path)}
                  onClick={() => toggleDir(row.path)}
                  title={row.path}
                >
                  <Icon name="chevronDown" className="file-tree-chevron" />
                  <span className="file-tree-name">{row.name}</span>
                  <span className="file-tree-count">{row.fileCount}</span>
                </button>
              </li>
            ) : (
              <li key={row.key}>
                <button
                  className={activePath === row.item.path ? "file-row active" : "file-row"}
                  style={mode === "tree" ? { paddingLeft: 4 + row.depth * 12 } : undefined}
                  onClick={() => onSelect(row.item.path)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onSelect(row.item.path);
                    onContextMenu(event, row.item.path);
                  }}
                  title={fullLabel(row.item)}
                >
                  <span className={`file-status file-status-${row.item.status}`}>
                    {STATUS_LETTER[row.item.status]}
                  </span>
                  <span className="file-path">{row.name}</span>
                  <span className="file-stats">
                    {row.item.gitlink ? (
                      <span className="muted">gitlink</span>
                    ) : row.item.binary ? (
                      <span className="muted">bin</span>
                    ) : (
                      <>
                        <span className="diff-add">+{row.item.additions}</span>
                        <span className="diff-del">-{row.item.deletions}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
