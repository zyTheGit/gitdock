import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../i18n";
import { FileListModeToggle } from "../../shared/FileListModeToggle";
import type { FileListMode } from "../../shared/useFileListMode";
import type { StagingFileDto } from "../../shared/types";
import { StagingFileList, sideKey, type Side } from "./StagingFileList";

interface StagingGroupProps {
  side: Side;
  title: string;
  files: StagingFileDto[];
  checked: Record<string, boolean>;
  activePath: string | null;
  disabled: boolean;
  mode: FileListMode;
  onModeChange: (mode: FileListMode) => void;
  /** 暂存/取消暂存给定文件集合（所选或全部）。 */
  onMutate: (side: Side, paths: string[]) => void;
  /** 丢弃所选改动（破坏性）；仅未暂存一侧提供，未提供则不渲染该入口。 */
  onDiscardSelected?: (paths: string[]) => void;
  onToggleCheck: (side: Side, path: string) => void;
  onToggleCheckGroup: (side: Side, paths: string[], value: boolean) => void;
  onSelect: (file: StagingFileDto, side: Side) => void;
  onContextMenu: (event: ReactMouseEvent, side: Side, path: string) => void;
}

/** 暂存区单列：全选、所选/全部暂存、丢弃所选（仅未暂存）与文件列表（支持扁平/目录树两种展示）。 */
export function StagingGroup({
  side,
  title,
  files,
  checked,
  activePath,
  disabled,
  mode,
  onModeChange,
  onMutate,
  onDiscardSelected,
  onToggleCheck,
  onToggleCheckGroup,
  onSelect,
  onContextMenu,
}: StagingGroupProps) {
  const { t } = useI18n();
  const selectedPaths = files
    .filter((file) => checked[sideKey(side, file.path)])
    .map((file) => file.path);
  const allChecked = files.length > 0 && selectedPaths.length === files.length;

  const allLabel = side === "unstaged" ? t("staging.stageAll") : t("staging.unstageAll");
  const selectAllLabel =
    side === "unstaged" ? t("staging.selectAllUnstagedFiles") : t("staging.selectAllStagedFiles");
  const selectedLabel =
    side === "unstaged"
      ? selectedPaths.length > 0
        ? t("staging.stageSelectedCount", { n: selectedPaths.length })
        : t("staging.stageSelected")
      : selectedPaths.length > 0
        ? t("staging.unstageSelectedCount", { n: selectedPaths.length })
        : t("staging.unstageSelected");

  return (
    <section className="staging-group" aria-label={title}>
      <header className="staging-group-head">
        <label className="staging-group-check">
          <input
            type="checkbox"
            checked={allChecked}
            disabled={files.length === 0 || disabled}
            onChange={(event) => onToggleCheckGroup(side, files.map((file) => file.path), event.target.checked)}
            aria-label={selectAllLabel}
          />
          <strong>{title}</strong>
        </label>
        <span className="muted">{files.length}</span>
        <FileListModeToggle mode={mode} onChange={onModeChange} className="staging-mode-toggle" />
        <div className="staging-group-actions">
          <button
            disabled={selectedPaths.length === 0 || disabled}
            onClick={() => onMutate(side, selectedPaths)}
          >
            {selectedLabel}
          </button>
          <button
            disabled={files.length === 0 || disabled}
            onClick={() => onMutate(side, files.map((file) => file.path))}
          >
            {allLabel}
          </button>
          {onDiscardSelected && selectedPaths.length > 0 && (
            <button
              className="danger"
              disabled={disabled}
              onClick={() => onDiscardSelected(selectedPaths)}
            >
              {t("staging.discardSelectedCount", { n: selectedPaths.length })}
            </button>
          )}
        </div>
      </header>
      {files.length === 0 ? (
        <p className="staging-empty muted">
          {side === "staged" ? t("staging.emptyStaged") : t("staging.emptyUnstaged")}
        </p>
      ) : (
        <StagingFileList
          side={side}
          files={files}
          activePath={activePath}
          checked={checked}
          disabled={disabled}
          onSelect={onSelect}
          onToggleCheck={onToggleCheck}
          onToggleCheckGroup={onToggleCheckGroup}
          onRowAction={(fileSide, path) => onMutate(fileSide, [path])}
          onRowContextMenu={onContextMenu}
        />
      )}
    </section>
  );
}
