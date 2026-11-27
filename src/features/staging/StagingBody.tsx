import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";
import { useI18n } from "../../i18n";
import type { FileDiffDto, RepoStateDto, StagingFileDto, StagingStatusDto } from "../../shared/types";
import type { FileListMode } from "../../shared/useFileListMode";
import { FileDiffView } from "../diff/FileDiffView";
import type { HunkActionsConfig } from "../diff/HunkActions";
import { CommitComposer } from "./CommitComposer";
import { ConflictFilesSection } from "./ConflictFilesSection";
import { StagingGroup } from "./StagingGroup";
import type { Side } from "./StagingFileList";
import type { HunkSelection } from "./useHunkFlow";

interface StagingBodyProps {
  status: StagingStatusDto | null;
  loading: boolean;
  repo: RepoStateDto;
  /** 写操作禁用：应用忙碌、中断态、bare 或 Git 版本不支持。 */
  disabled: boolean;
  /** 冲突三件套的禁用条件（ADR-0033）。 */
  conflictDisabled: boolean;
  checked: Record<string, boolean>;
  selection: HunkSelection | null;
  fileListMode: FileListMode;
  onFileListModeChange: (mode: FileListMode) => void;
  busyRef: MutableRefObject<boolean>;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  reload: () => Promise<StagingStatusDto | null>;
  onMutated: (message: string) => Promise<void>;
  onOpenTerminal: () => void;
  commitCommitted: (message: string) => Promise<void>;
  onMutate: (side: Side, paths: string[]) => void;
  onSelect: (file: StagingFileDto, side: Side) => void;
  onOpenDiscard: (paths: string[]) => void;
  onToggleCheck: (side: Side, path: string) => void;
  onToggleCheckGroup: (side: Side, paths: string[], value: boolean) => void;
  onOpenFileMenu: (event: ReactMouseEvent, side: Side, path: string) => void;
  diff: FileDiffDto | null;
  diffLoading: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  hunkActions?: HunkActionsConfig;
}

/** 暂存区主体：两列文件列表 + 冲突区 + 提交表单 + 右侧 diff。 */
export function StagingBody({
  status,
  loading,
  repo,
  disabled,
  conflictDisabled,
  checked,
  selection,
  fileListMode,
  onFileListModeChange,
  busyRef,
  setBusy,
  setError,
  reload,
  onMutated,
  onOpenTerminal,
  commitCommitted,
  onMutate,
  onSelect,
  onOpenDiscard,
  onToggleCheck,
  onToggleCheckGroup,
  onOpenFileMenu,
  diff,
  diffLoading,
  expanded,
  onExpandedChange,
  hunkActions,
}: StagingBodyProps) {
  const { t } = useI18n();

  if (status?.is_bare) {
    return (
      <div className="placeholder">
        <p className="muted">{t("staging.bareRepoHint")}</p>
      </div>
    );
  }
  if (loading && !status) {
    return (
      <div className="placeholder">
        <p className="muted">{t("staging.loadingStatus")}</p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="placeholder">
        <p className="muted">{t("staging.statusUnavailable")}</p>
      </div>
    );
  }

  return (
    <div className="staging-body">
      <div className="staging-lists">
        {(
          [
            ["unstaged", t("staging.groupUnstaged"), status.unstaged],
            ["staged", t("staging.groupStaged"), status.staged],
          ] as const
        ).map(([side, title, files]) => (
          <StagingGroup
            key={side}
            side={side}
            title={title}
            files={files}
            checked={checked}
            activePath={selection?.side === side ? selection.path : null}
            disabled={disabled}
            mode={fileListMode}
            onModeChange={onFileListModeChange}
            onMutate={onMutate}
            onDiscardSelected={side === "unstaged" ? onOpenDiscard : undefined}
            onToggleCheck={onToggleCheck}
            onToggleCheckGroup={onToggleCheckGroup}
            onSelect={onSelect}
            onContextMenu={onOpenFileMenu}
          />
        ))}
        {status.conflicted_files.length > 0 && (
          <ConflictFilesSection
            paths={status.conflicted_files}
            kinds={repo.interruption.kinds}
            disabled={conflictDisabled}
            isBusy={() => busyRef.current}
            setBusy={setBusy}
            setError={setError}
            reload={() => reload()}
            onMutated={onMutated}
            onOpenTerminal={onOpenTerminal}
          />
        )}
        <CommitComposer
          repoPath={repo.path}
          unborn={status.unborn}
          hasStaged={status.staged.length > 0}
          disabled={disabled || status.conflicted_files.length > 0}
          onBusyChange={setBusy}
          onCommitted={commitCommitted}
        />
      </div>

      <div className="staging-diff">
        {selection && diff ? (
          <FileDiffView
            diff={diff}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            loading={diffLoading}
            hunkActions={hunkActions}
            sideLabels={
              selection.side === "staged"
                ? { left: t("diff.sideHead"), right: t("diff.sideIndex") }
                : selection.side === "unstaged"
                  ? { left: t("diff.sideIndex"), right: t("diff.sideWorktree") }
                  : { left: t("diff.sideEmpty"), right: t("diff.sideWorktree") }
            }
          />
        ) : (
          <div className="placeholder">
            <p className="muted">
              {diffLoading ? t("staging.readingDiff") : t("staging.diffPlaceholder")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
