import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfoDto,
  BranchDescriptionDto,
  CompareResultDto,
  CommitDetailDto,
  FileDiffDto,
  GateReportDto,
  GraphPageDto,
  GraphScope,
  InterruptionDto,
  RepoStateDto,
  SearchPageDto,
  SearchRequest,
  SettingsDto,
  UserVisibleError,
  WorkspaceStatusDto,
  WriteOutcomeDto,
  WriteRequest,
} from "./types";

// 唯一的跨进程 seam：只暴露白名单 command，禁止任意命令执行与任意路径读取。
export class CommandError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(error: UserVisibleError) {
    super(error.message);
    this.code = error.code;
    this.detail = error.detail;
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
  appInfo: () => call<AppInfoDto>("app_info"),
  loadSettings: () => call<SettingsDto>("load_settings"),
  saveSettings: (settings: SettingsDto) => call<SettingsDto>("save_settings", { settings }),
  rememberRepository: (path: string) => call<SettingsDto>("remember_repository", { path }),
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
  validateWrite: (request: WriteRequest) => call<GateReportDto>("validate_write", { request }),
  executeWrite: (request: WriteRequest) => call<WriteOutcomeDto>("execute_write", { request }),
  inspectInterruption: () => call<InterruptionDto>("inspect_interruption"),
  workspaceStatus: () => call<WorkspaceStatusDto>("workspace_status"),
  readBranchDescription: (branch: string) =>
    call<BranchDescriptionDto>("read_branch_description", { branch }),
};
