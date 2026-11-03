import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import { STATUS_LETTER, statusLabelKey } from "../../shared/fileStatus";
import type { StagingFileDto } from "../../shared/types";

/** 暂存区列别：未暂存或已暂存。 */
export type Side = "staged" | "unstaged";

/** 勾选状态的键：同一路径可能在两列各自出现，勾选状态按列隔离。 */
export const sideKey = (side: Side, path: string) => `${side}:${path}`;

// 行高初值（12px 文本 + 上下 padding）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const ROW_ESTIMATE = 24;
const LIST_OVERSCAN = 10;

function pathLabel(file: StagingFileDto): string {
  return file.old_path && file.old_path !== file.path
    ? `${file.old_path} → ${file.path}`
    : file.path;
}


interface StagingFileListProps {
  side: Side;
  files: StagingFileDto[];
  /** 当前列选中的文件路径（与另一列的选择互不影响）。 */
  activePath: string | null;
  checked: Record<string, boolean>;
  disabled: boolean;
  onSelect: (file: StagingFileDto, side: Side) => void;
  onToggleCheck: (side: Side, path: string) => void;
  onRowAction: (side: Side, path: string) => void;
}

/** 暂存区单列文件列表：虚拟化渲染，未暂存/已暂存两列各自实例化、独立滚动。 */
export function StagingFileList({
  side,
  files,
  activePath,
  checked,
  disabled,
  onSelect,
  onToggleCheck,
  onRowAction,
}: StagingFileListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => files[index]?.path ?? index,
  });
  const action = side === "unstaged" ? t("staging.actionStage") : t("staging.actionUnstage");

  const fileMeta = (file: StagingFileDto) => {
    if (file.untracked) {
      return <span className="muted">{t("staging.untracked")}</span>;
    }
    if (file.gitlink) {
      return <span className="muted">{t("staging.submodule")}</span>;
    }
    if (file.binary) {
      return <span className="muted">{t("staging.binary")}</span>;
    }
    return (
      <>
        <span className="diff-add">+{file.additions}</span>
        <span className="diff-del">-{file.deletions}</span>
      </>
    );
  };

  return (
    <div className="staging-list" ref={scrollRef}>
      <ul className="staging-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const file = files[item.index];
          if (!file) {
            return null;
          }
          const active = activePath === file.path;
          return (
            <li
              key={item.key}
              data-index={item.index}
              ref={(node) => virtualizer.measureElement(node)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              <div
                className={active ? "staging-row active" : "staging-row"}
                onClick={() => onSelect(file, side)}
              >
                <input
                  className="staging-check"
                  type="checkbox"
                  checked={Boolean(checked[sideKey(side, file.path)])}
                  onChange={() => onToggleCheck(side, file.path)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={t("staging.selectFile", { path: file.path })}
                />
                <span
                  className={`file-status file-status-${file.status}`}
                  title={t(statusLabelKey(file.status))}
                >
                  {STATUS_LETTER[file.status]}
                </span>
                <span className="staging-path mono" title={pathLabel(file)}>
                  {pathLabel(file)}
                </span>
                <span className="staging-stats">{fileMeta(file)}</span>
                <button
                  className="staging-row-action"
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRowAction(side, file.path);
                  }}
                >
                  {action}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}