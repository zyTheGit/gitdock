import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppInfoDto,
  BranchDescriptionDto,
  CommandLogEntryDto,
  CommitBranchContextDto,
  CompareResultDto,
  CommitDetailDto,
  FileDiffDto,
  GateReportDto,
  GraphPageDto,
  GraphScope,
  GitConfigDto,
  GitConfigEntry,
  GitConfigScope,
  InterruptionDto,
  RepoStateDto,
  SearchPageDto,
  SearchRequest,
  SettingsDto,
  StagingStatusDto,
  StashEntryDto,
  TerminalCapabilitiesDto,
  TerminalEvent,
  UpdateCheckDto,
  UserVisibleError,
  WorkspaceStatusDto,
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

export const ipc = {
  uiReady: () => call<void>("ui_ready"),
  appInfo: () => call<AppInfoDto>("app_info"),
  openFeedbackIssue: (title: string, body: string) =>
    call<void>("open_feedback_issue", { title, body }),
  checkForUpdate: () => call<UpdateCheckDto>("check_for_update"),
  openReleasePage: (url: string) => call<void>("open_release_page", { url }),
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
  repositoryState: () => call<RepoStateDto>("repository_state"),
  closeRepository: () => call<void>("close_repository"),
  readGraphPage: (scope: GraphScope, cursor: string | null, limit?: number) =>
    call<GraphPageDto>("read_graph_page", { scope, cursor, limit }),
  readGraphPageAround: (scope: GraphScope, oid: string, limit?: number) =>
    call<GraphPageDto>("read_graph_page_around", { scope, oid, limit }),
  readCommit: (oid: string) => call<CommitDetailDto>("read_commit", { oid }),
  branchesContaining: (oid: string) => call<string[]>("branches_containing", { oid }),
  commitBranchContext: (oid: string, limit = 3) =>
    call<CommitBranchContextDto>("commit_branch_context", { oid, limit }),
  readFileDiff: (oid: string, path: string) => call<FileDiffDto>("read_file_diff", { oid, path }),
  compare: (base: string, compareOid: string, pathFilter: string | undefined, twoDot: boolean) =>
    call<CompareResultDto>("compare_commits", { base, compareOid, pathFilter, twoDot }),
  compareFileDiff: (base: string, compareOid: string, path: string, twoDot: boolean) =>
    call<FileDiffDto>("compare_file_diff", { base, compareOid, path, twoDot }),
  search: (request: SearchRequest, cursor: string | null) =>
    call<SearchPageDto>("search", { request, cursor }),
  cancelSearch: (searchId: string) => call<void>("cancel_search", { searchId }),
  launchExternalDiff: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
    threeDot: boolean,
  ) =>
    call<void>("launch_external_diff", { toolIndex, left, right, path, threeDot }),
  /** 目录级对比：导出两侧提交的完整树到临时目录后再交给同一工具（ADR-0025）。 */
  launchExternalDirDiff: (toolIndex: number, base: string, compareOid: string) =>
    call<void>("launch_external_dir_diff", { toolIndex, base, compareOid }),
  validateWrite: (request: WriteRequest) => call<GateReportDto>("validate_write", { request }),
  executeWrite: (request: WriteRequest) => call<WriteOutcomeDto>("execute_write", { request }),
  inspectInterruption: () => call<InterruptionDto>("inspect_interruption"),
  workspaceStatus: () => call<WorkspaceStatusDto>("workspace_status"),
  stagingStatus: () => call<StagingStatusDto>("staging_status"),
  readStagingDiff: (path: string, staged: boolean) =>
    call<FileDiffDto>("read_staging_diff", { path, staged }),
  /** 当前 HEAD 提交消息（amend 预填）；unborn/空仓库返回 null。 */
  readHeadMessage: () => call<string | null>("read_head_message"),
  /** 本地 stash 列表（index 0 最新）。 */
  readStashes: () => call<StashEntryDto[]>("read_stashes"),
  readBranchDescription: (branch: string) =>
    call<BranchDescriptionDto>("read_branch_description", { branch }),
  readGitConfig: () => call<GitConfigDto>("read_git_config"),
  saveGitConfig: (scope: GitConfigScope, entries: GitConfigEntry[]) =>
    call<GitConfigDto>("save_git_config", { scope, entries }),
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
