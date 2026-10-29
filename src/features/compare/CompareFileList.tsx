import type { MouseEvent } from "react";
import { STATUS_LETTER } from "../../shared/fileStatus";
import type { ChangedFileDto } from "../../shared/types";

interface CompareFileListProps {
  files: ChangedFileDto[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
}

export function CompareFileList({
  files,
  activePath,
  onSelect,
  onContextMenu,
}: CompareFileListProps) {
  return (
    <div className="detail-files">
      <h3>变更文件（{files.length}）</h3>
      {files.length === 0 ? (
        <p className="muted">此范围没有文件变更。</p>
      ) : (
        <ul className="file-list compare-file-list">
          {files.map((file) => (
            <li key={file.path}>
              <button
                className={activePath === file.path ? "file-row active" : "file-row"}
                onClick={() => onSelect(file.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelect(file.path);
                  onContextMenu(event, file.path);
                }}
                title={file.path}
              >
                <span className={`file-status file-status-${file.status}`}>
                  {STATUS_LETTER[file.status]}
                </span>
                <span className="file-path">{file.path}</span>
                <span className="file-stats">
                  {file.gitlink ? (
                    <span className="muted">gitlink</span>
                  ) : file.binary ? (
                    <span className="muted">bin</span>
                  ) : (
                    <>
                      <span className="diff-add">+{file.additions}</span>
                      <span className="diff-del">-{file.deletions}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
