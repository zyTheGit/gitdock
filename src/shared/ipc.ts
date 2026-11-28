import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppInfoDto,
  BranchDescriptionDto,
  CommandLogEntryDto,
  CommitBranchContextDto,
  CompareResultDto,
  CommitDetailDto,
  CommitTemplateDto,
  FileBlameDto,
  FileDiffDto,
  FileHistoryPageDto,
  GateReportDto,
  GraphPageDto,
  GraphScope,
  GitConfigDto,
  GitConfigEntry,
  GitConfigScope,
  InterruptionDto,
  RepoId,
  RepoListDto,
  RepoRestoreDto,
  RepoStateDto,
  ReflogEntryDto,
  SearchPageDto,
  SearchRequest,
  SettingsDto,
  StagingStatusDto,
  StashDetailDto,
  StashEntryDto,
  TerminalCapabilitiesDto,
  TerminalEvent,
  UpdateCheckDto,
  UpdateDownloadResultDto,
  UpdateInstallDto,
  UserVisibleError,
  WorkspaceStatusDto,
  WorktreeDto,
  WriteKind,
  WriteOutcomeDto,
  WriteRequest,
} from "./types";

// 唯一的跨进程 seam：只暴露白名单 command，禁止任意命令执行与任意路径读取。
export class CommandError extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly key?: string | null;
  readonly args?: Record<string, string> | null;

  constructor(error: UserVisibleError) {
    super(error.message);
    this.code = error.code;
    this.detail = error.detail;
    this.key = error.key;
    this.args = error.args;
  }
}

let currentIpcRepoId: RepoId | null = null;

/** 同步更新当前活动仓库 id，使全部仓库级读写命令显式路由到发起时的标签（ADR-0039）。 */
export function setActiveIpcRepoId(repoId: RepoId | null): void {
  currentIpcRepoId = repoId;
}

export function activeIpcRepoId(): RepoId | null {
  return currentIpcRepoId;
}

function repoTarget(explicit?: RepoId): RepoId | undefined {
  return explicit ?? currentIpcRepoId ?? undefined;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (raw && typeof raw === "object" && "code" in raw && "message" in raw) {
      throw new CommandError(raw as UserVisibleError);
    }
    throw new CommandError({ code: "internal", message: String(raw) });
  }
}

/**
 * worktree 系列共用同一 WriteRequest 形状（ADR-0034）：创建用 path + branch，
 * 移除只用 path；写前检查仍走 validateWrite 预览，这里只统一执行请求。
 */
function worktreeRequest(
  kind: Extract<WriteKind, "create_worktree" | "remove_worktree">,
  path: string,
  branch?: string,
): WriteRequest {
  return { kind, path, branch };
}

export const ipc = {
  uiReady: () => call<void>("ui_ready"),
  appInfo: () => call<AppInfoDto>("app_info"),
  openFeedbackIssue: (title: string, body: string) =>
    call<void>("open_feedback_issue", { title, body }),
  checkForUpdate: () => call<UpdateCheckDto>("check_for_update"),
  downloadUpdate: () => call<UpdateDownloadResultDto>("download_update"),
  cancelUpdateDownload: () => call<void>("cancel_update_download"),
  installDownloadedUpdate: () => call<UpdateInstallDto>("install_downloaded_update"),
  revealDownloadedUpdate: () => call<void>("reveal_downloaded_update"),
  openReleasePage: (url: string) => call<void>("open_release_page", { url }),
  revealInFileManager: (path: string) => call<void>("reveal_in_file_manager", { path }),
  loadSettings: () => call<SettingsDto>("load_settings"),
  saveSettings: (settings: SettingsDto) => call<SettingsDto>("save_settings", { settings }),
  setLanguage: (language: string | null) => call<SettingsDto>("set_language", { language }),
  setShellProfile: (profile: "default" | "git_bash") =>
    call<SettingsDto>("set_shell_profile", { profile }),
  rememberRepository: (path: string) => call<SettingsDto>("remember_repository", { path }),
  forgetRecentRepository: (path: string) =>
    call<SettingsDto>("forget_recent_repository", { path }),
  startupRepository: () => call<string | null>("startup_repository"),
  openRepository: (path: string) => call<RepoStateDto>("open_repository", { path }),
  /** 启动恢复：全部标签一次登记，仅活动仓库返回完整状态（ADR-0036）。 */
  restoreRepositories: (paths: string[], active: string | null) =>
    call<RepoRestoreDto>("restore_repositories", { paths, active }),
  /** 标签栏与启动恢复的唯一来源（ADR-0032）。 */
  listRepositories: () => call<RepoListDto>("list_repositories"),
  /** 切换活动标签。 */
  activateRepository: (repoId: RepoId) =>
    call<RepoStateDto>("activate_repository", { repoId }),
  repositoryState: (repoId?: RepoId) =>
    call<RepoStateDto>("repository_state", { repoId: repoTarget(repoId) }),
  /** 关闭标签；缺省 repoId 关闭活动标签，返回接替者状态或 null（没有剩余标签）。 */
  closeRepository: (repoId?: RepoId) =>
    repoId === undefined
      ? call<RepoStateDto | null>("close_repository")
      : call<RepoStateDto | null>("close_repository", { repoId }),
  readGraphPage: (scope: GraphScope, cursor: string | null, limit?: number) =>
    call<GraphPageDto>("read_graph_page", { scope, cursor, limit, repoId: repoTarget() }),
  readGraphPageAround: (scope: GraphScope, oid: string, limit?: number) =>
    call<GraphPageDto>("read_graph_page_around", { scope, oid, limit, repoId: repoTarget() }),
  readCommit: (oid: string) => call<CommitDetailDto>("read_commit", { oid, repoId: repoTarget() }),
  branchesContaining: (oid: string) =>
    call<string[]>("branches_containing", { oid, repoId: repoTarget() }),
  commitBranchContext: (oid: string, limit = 3) =>
    call<CommitBranchContextDto>("commit_branch_context", { oid, limit, repoId: repoTarget() }),
  readFileDiff: (oid: string, path: string, ignoreWhitespace = false) =>
    call<FileDiffDto>("read_file_diff", { oid, path, ignoreWhitespace, repoId: repoTarget() }),
  compare: (base: string, compareOid: string, pathFilter: string | undefined, twoDot: boolean) =>
    call<CompareResultDto>("compare_commits", {
      base,
      compareOid,
      pathFilter,
      twoDot,
      repoId: repoTarget(),
    }),
  compareFileDiff: (
    base: string,
    compareOid: string,
    path: string,
    twoDot: boolean,
    ignoreWhitespace = false,
  ) =>
    call<FileDiffDto>("compare_file_diff", {
      base,
      compareOid,
      path,
      twoDot,
      ignoreWhitespace,
      repoId: repoTarget(),
    }),
  /**
   * 单文件提交历史（ADR-0031）：`oidOrScope` 缺省/null 表示 HEAD 可达提交，
   * 传具体 OID 表示从该提交（含）向前追溯；`cursor` 为不透明游标。
   */
  readFileHistory: (
    path: string,
    oidOrScope: string | null,
    cursor: string | null,
    limit?: number,
  ) =>
    call<FileHistoryPageDto>("read_file_history", {
      path,
      oidOrScope,
      cursor,
      limit,
      repoId: repoTarget(),
    }),
  /** 行级追溯：必须给出具体提交 OID；二进制/超大文件以标记降级而非报错。 */
  readFileBlame: (oid: string, path: string) =>
    call<FileBlameDto>("read_file_blame", { oid, path, repoId: repoTarget() }),
  search: (request: SearchRequest, cursor: string | null) =>
    call<SearchPageDto>("search", { request, cursor, repoId: repoTarget() }),
  cancelSearch: (searchId: string) =>
    call<void>("cancel_search", { searchId, repoId: repoTarget() }),
  launchExternalDiff: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
    threeDot: boolean,
  ) =>
    call<void>("launch_external_diff", {
      toolIndex,
      left,
      right,
      path,
      threeDot,
      repoId: repoTarget(),
    }),
  /** 目录级对比：导出两侧提交的完整树到临时目录后再交给同一工具（ADR-0025）。 */
  launchExternalDirDiff: (toolIndex: number, base: string, compareOid: string) =>
    call<void>("launch_external_dir_diff", {
      toolIndex,
      base,
      compareOid,
      repoId: repoTarget(),
    }),
  validateWrite: (request: WriteRequest, repoId?: RepoId) =>
    call<GateReportDto>("validate_write", { request, repoId: repoTarget(repoId) }),
  executeWrite: (request: WriteRequest, repoId?: RepoId) =>
    call<WriteOutcomeDto>("execute_write", { request, repoId: repoTarget(repoId) }),
  inspectInterruption: () =>
    call<InterruptionDto>("inspect_interruption", { repoId: repoTarget() }),
  workspaceStatus: () => call<WorkspaceStatusDto>("workspace_status", { repoId: repoTarget() }),
  stagingStatus: () => call<StagingStatusDto>("staging_status", { repoId: repoTarget() }),
  readStagingDiff: (path: string, staged: boolean, ignoreWhitespace = false) =>
    call<FileDiffDto>("read_staging_diff", {
      path,
      staged,
      ignoreWhitespace,
      repoId: repoTarget(),
    }),
  /** 当前 HEAD 提交消息（amend 预填）；unborn/空仓库返回 null。 */
  readHeadMessage: () => call<string | null>("read_head_message", { repoId: repoTarget() }),
  /** worktree 列表（ADR-0034）：首条为主 worktree；只读，不经过 Gate。 */
  readWorktrees: () => call<WorktreeDto[]>("read_worktrees", { repoId: repoTarget() }),
  /** 仓库配置的 `commit.template`；未配置、文件缺失或超限时返回 null。 */
  readCommitTemplate: () =>
    call<CommitTemplateDto | null>("read_commit_template", { repoId: repoTarget() }),
  /** 创建 linked worktree：执行 `git worktree add <path> <branch>`；写前检查用 validateWrite 预览。 */
  createWorktree: (path: string, branch: string) => {
    const request = worktreeRequest("create_worktree", path, branch);
    return call<WriteOutcomeDto>("execute_write", { request, repoId: repoTarget() });
  },
  /** 移除 linked worktree：执行 `git worktree remove <path>`，绝不 `--force`。 */
  removeWorktree: (path: string) => {
    const request = worktreeRequest("remove_worktree", path);
    return call<WriteOutcomeDto>("execute_write", { request, repoId: repoTarget() });
  },
  /** 本地 stash 列表（index 0 最新）。 */
  readStashes: () => call<StashEntryDto[]>("read_stashes", { repoId: repoTarget() }),
  /** 单条 stash 的改动文件清单（ADR-0030）；未跟踪文件来自第三个父提交。 */
  readStashDetail: (oid: string) =>
    call<StashDetailDto>("read_stash_detail", { oid, repoId: repoTarget() }),
  readStashFileDiff: (oid: string, path: string, ignoreWhitespace = false) =>
    call<FileDiffDto>("read_stash_file_diff", {
      oid,
      path,
      ignoreWhitespace,
      repoId: repoTarget(),
    }),
  /** HEAD reflog（只读，最新在前）；limit 缺省 200，服务端 clamp 到 [1, 1000]（ADR-0029）。 */
  readReflog: (limit?: number) =>
    call<ReflogEntryDto[]>("read_reflog", { limit, repoId: repoTarget() }),
  readBranchDescription: (branch: string) =>
    call<BranchDescriptionDto>("read_branch_description", { branch, repoId: repoTarget() }),
  readGitConfig: () => call<GitConfigDto>("read_git_config", { repoId: repoTarget() }),
  saveGitConfig: (scope: GitConfigScope, entries: GitConfigEntry[]) =>
    call<GitConfigDto>("save_git_config", { scope, entries, repoId: repoTarget() }),
  terminalCapabilities: () => call<TerminalCapabilitiesDto>("terminal_capabilities"),
  terminalOpen: (mode: string, cols: number, rows: number, channel: Channel<TerminalEvent>) =>
    call<number>("terminal_open", { mode, cols, rows, channel }),
  terminalWrite: (id: number, data: string) => call<void>("terminal_write", { id, data }),
  terminalResize: (id: number, cols: number, rows: number) =>
    call<void>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: number) => call<void>("terminal_close", { id }),
  /** git CLI 命令日志快照（内存环形缓冲的只读拷贝，新条目在后）。 */
  gitCommandLog: () => call<CommandLogEntryDto[]>("git_command_log"),
  /** 清空本次运行的内存命令日志；磁盘应用日志不变。 */
  clearCommandLog: () => call<void>("clear_git_command_log"),
};
