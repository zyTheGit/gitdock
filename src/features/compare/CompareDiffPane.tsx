import { FileDiffView } from "../diff/FileDiffView";
import type { ChangedFileDto, FileDiffDto } from "../../shared/types";

interface CompareDiffPaneProps {
  /** Base/Compare 变化时重建高亮视图。 */
  diffKey: string;
  diff: FileDiffDto | null;
  loading: boolean;
  error: string | null;
  files: ChangedFileDto[];
  activePath: string | null;
  onSelectFile: (path: string) => void;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
}

export function CompareDiffPane({
  diffKey,
  diff,
  loading,
  error,
  files,
  activePath,
  onSelectFile,
  expanded,
  onExpandedChange,
}: CompareDiffPaneProps) {
  return (
    <div className="detail-diff">
      {loading && !expanded && <p className="muted">正在读取文件 diff…</p>}
      {error && <div className="banner danger">{error}</div>}
      {diff && (
        <FileDiffView
          key={diffKey}
          diff={diff}
          files={files}
          activePath={activePath ?? undefined}
          onSelectFile={onSelectFile}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          loading={loading}
        />
      )}
      {!loading && !diff && !error && files.length > 0 && (
        <p className="muted">选择左侧文件查看 diff。</p>
      )}
    </div>
  );
}
