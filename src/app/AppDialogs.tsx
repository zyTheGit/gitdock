import type { ReactNode } from "react";
import { AppMenus } from "./AppMenus";
import type {
  BranchMenuState,
  RowMenuState,
  TagMenuState,
  useCommitMenus,
} from "./useCommitMenus";
import type { useFontScale } from "./useFontScale";
import type { useSettingsEntry } from "./useSettingsEntry";
import {
  clearSkippedUpdate,
  openReleasePage,
  pendingUpdate,
  runUpdateCheck,
  skipAvailableUpdate,
} from "./useUpdateCheck";
import type { useWriteFlow } from "./useWriteFlow";
import { OperationNotice } from "./OperationNoticeView";
import type { OperationNotice as OperationNoticeModel, OperationNoticeAction } from "./operationNotice";
import { BranchCompareDialog } from "../features/compare/BranchCompareDialog";
import { SearchView } from "../features/search/SearchView";
import type { SearchLoader } from "../features/search/useSearch";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { UpdateDialog } from "../features/settings/UpdateDialog";
import { BranchDescriptionDialog } from "../features/write/BranchDescriptionDialog";
import { ConfirmWriteDialog } from "../features/write/ConfirmWriteDialog";
import { TagDescriptionDialog } from "../features/write/TagDescriptionDialog";
import { toLanguagePreference } from "../i18n";
import type { useAppLanguage } from "../i18n/useAppLanguage";
import type {
  AppInfoDto,
  CommitSummaryDto,
  RefDto,
  RepoStateDto,
  SettingsDto,
  UpdateCheckState,
} from "../shared/types";

interface AppDialogsProps {
  repo: RepoStateDto | null;
  searchOpen: boolean;
  settings: SettingsDto | null;
  info: AppInfoDto | null;
  toast: string | null;
  notice: OperationNoticeModel | null;
  onDismissNotice: (id: number) => void;
  onNoticeAction: (action: OperationNoticeAction) => void;

  /** 搜索面板：搜索状态仍由 App 的 useSearch 持有。 */
  search: SearchLoader;
  searchCommits: CommitSummaryDto[];
  onLocateCommit: (oid: string) => void;
  onCloseSearch: () => void;

  /** 提交行 / 分支 / 标签右键菜单：条目由 useCommitMenus 组装，这里只挂载。 */
  commitMenus: ReturnType<typeof useCommitMenus>;
  rowMenu: RowMenuState | null;
  branchMenu: BranchMenuState | null;
  tagMenu: TagMenuState | null;
  onRowClose: () => void;
  onBranchClose: () => void;
  onTagClose: () => void;

  /** 分支 / 标签描述编辑器。 */
  descriptionBranch: string | null;
  descriptionTag: RefDto | null;
  onCloseDescriptionBranch: () => void;
  onCloseDescriptionTag: () => void;
  onDescriptionSaved: (message: string) => void;

  /** 写操作确认框：Gate 结论与执行状态由 useWriteFlow 提供。 */
  write: ReturnType<typeof useWriteFlow>;
  /** 分支/标签写对话框与 stash 面板：内容由各自的 hook 渲染后传入。 */
  refDialogs: ReactNode;
  stashDialog: ReactNode;

  /** 引用对比选择框：本地分支、远程分支与标签。 */
  branchCompareOpen: boolean;
  refs: RefDto[];
  headBranch: string | null;
  initialBase?: string;
  initialCompare?: string;
  onCloseBranchCompare: () => void;
  onConfirmBranchCompare: (base: RefDto, compare: RefDto) => void;

  /** 设置弹窗：更新检查与缩放动作挂在各自 hook 的返回值上。 */
  settingsEntry: ReturnType<typeof useSettingsEntry>;
  zoom: ReturnType<typeof useFontScale>;
  language: ReturnType<typeof useAppLanguage>;
  updateCheck: UpdateCheckState;
  updateDialogOpen: boolean;
  onCloseUpdateDialog: () => void;
  onSettingsSaved: (settings: SettingsDto) => void;
  onSettingsError: (message: string) => void;
}

/**
 * 覆盖在主界面之上的弹层集合：搜索、右键菜单、描述编辑、写确认、分支对比与设置。
 * 状态与回调全部由 App 持有，这里只按原有渲染顺序做 JSX 组合。
 */
export function AppDialogs({
  repo,
  searchOpen,
  settings,
  info,
  toast,
  notice,
  onDismissNotice,
  onNoticeAction,
  search,
  searchCommits,
  onLocateCommit,
  onCloseSearch,
  commitMenus,
  rowMenu,
  branchMenu,
  tagMenu,
  onRowClose,
  onBranchClose,
  onTagClose,
  descriptionBranch,
  descriptionTag,
  onCloseDescriptionBranch,
  onCloseDescriptionTag,
  onDescriptionSaved,
  write,
  refDialogs,
  stashDialog,
  branchCompareOpen,
  refs,
  headBranch,
  initialBase,
  initialCompare,
  onCloseBranchCompare,
  onConfirmBranchCompare,
  settingsEntry,
  zoom,
  language,
  updateCheck,
  updateDialogOpen,
  onCloseUpdateDialog,
  onSettingsSaved,
  onSettingsError,
}: AppDialogsProps) {
  return (
    <>
      {searchOpen && repo && (
        <SearchView
          repo={repo}
          search={search}
          commits={searchCommits}
          onLocateCommit={onLocateCommit}
          onClose={onCloseSearch}
        />
      )}

      <AppMenus
        rowMenu={rowMenu}
        branchMenu={branchMenu}
        tagMenu={tagMenu}
        rowItems={commitMenus.activeRowMenuItems}
        branchItems={commitMenus.activeBranchMenuItems}
        tagItems={commitMenus.activeTagMenuItems}
        onRowClose={onRowClose}
        onBranchClose={onBranchClose}
        onTagClose={onTagClose}
      />

      {descriptionBranch && (
        <BranchDescriptionDialog
          branch={descriptionBranch}
          onCancel={onCloseDescriptionBranch}
          onSaved={onDescriptionSaved}
        />
      )}

      {descriptionTag && (
        <TagDescriptionDialog
          tag={descriptionTag.short_name}
          description={descriptionTag.description ?? ""}
          onCancel={onCloseDescriptionTag}
          onSaved={onDescriptionSaved}
        />
      )}

      {write.prompt && (
        <ConfirmWriteDialog
          kind={write.prompt.kind}
          commit={write.prompt.commit}
          commits={write.prompt.commits}
          branch={write.prompt.branch}
          interruption={write.prompt.interruption}
          gate={write.prompt.gate}
          gateError={write.prompt.gateError}
          validating={write.validating}
          mainline={write.mainline}
          onMainlineChange={write.changeMainline}
          busy={write.busy}
          onCancel={write.cancel}
          onConfirm={() => void write.run()}
        />
      )}
      {refDialogs}
      {stashDialog}
      {notice ? (
        <OperationNotice notice={notice} onDismiss={onDismissNotice} onAction={onNoticeAction} />
      ) : toast ? (
        <div className="toast" role="status">{toast}</div>
      ) : null}
      {branchCompareOpen && repo && refs.length >= 2 && (
        <BranchCompareDialog
          refs={refs}
          headBranch={headBranch}
          initialBase={initialBase}
          initialCompare={initialCompare}
          onCancel={onCloseBranchCompare}
          onConfirm={onConfirmBranchCompare}
        />
      )}

      {updateDialogOpen && updateCheck.result && (
        <UpdateDialog
          update={updateCheck.result}
          onOpenDownloadPage={openReleasePage}
          onSkipVersion={skipAvailableUpdate}
          onClose={onCloseUpdateDialog}
        />
      )}

      {settingsEntry.open && settings && (
        <SettingsDialog
          settings={settings}
          initialSection={settingsEntry.section}
          language={toLanguagePreference(settings.language)}
          onLanguageChange={language.changeLanguage}
          info={info}
          fontScale={zoom.fontScale}
          updateCheck={updateCheck}
          updateOffer={pendingUpdate(updateCheck)}
          onCheckUpdate={() => runUpdateCheck({ manual: true })}
          onOpenDownloadPage={openReleasePage}
          onSkipUpdate={skipAvailableUpdate}
          onClearSkippedUpdate={clearSkippedUpdate}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onResetZoom={zoom.resetZoom}
          onClose={settingsEntry.closeSettings}
          onSaved={onSettingsSaved}
          onError={onSettingsError}
        />
      )}
    </>
  );
}
