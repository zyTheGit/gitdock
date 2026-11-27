import { tLoose } from "../i18n";
import { outcomeMessage } from "../features/write/messages";
import type { RepoId, WriteKind, WriteOutcomeDto } from "../shared/types";

export type OperationNoticeTone = "success" | "warning" | "error";

interface NoticeActionBase {
  id: string;
  label: string;
  /** 不可用或执行中时保留按钮，但禁用并说明原因。 */
  disabledReason?: string;
}

export type OperationNoticeAction =
  | (NoticeActionBase & {
      target: "head" | "reflog" | "conflicts";
      oid?: string;
    })
  | (NoticeActionBase & {
      target: "remote";
      operation: "fetch" | "pull";
    });

export interface OperationNoticeInput {
  tone: OperationNoticeTone;
  title: string;
  summary: string;
  details?: string;
  stderr?: string;
  actions?: OperationNoticeAction[];
}

export interface OperationNoticeSession {
  repoPath: string | null;
  sessionKey: RepoId | null;
  epoch: number;
}

export interface OperationNotice extends OperationNoticeInput {
  id: number;
  repoPath: string | null;
  sessionKey: RepoId | null;
  sessionEpoch: number;
  /** 仅成功通知有；错误与警告必须由用户关闭或随仓库会话清理。 */
  expiresAt?: number;
}

export interface OperationNoticeSnapshot {
  session: OperationNoticeSession;
  notices: readonly OperationNotice[];
}

export const OPERATION_NOTICE_SUCCESS_TTL_MS = 4500;

let nextNoticeId = 1;
let nextSessionEpoch = 1;

function createSession(repoPath: string | null, sessionKey: RepoId | null): OperationNoticeSession {
  return { repoPath, sessionKey, epoch: nextSessionEpoch++ };
}

let activeSession = createSession(null, null);
let snapshot: OperationNoticeSnapshot = { session: activeSession, notices: [] };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function replaceNotices(notices: readonly OperationNotice[]): void {
  if (
    notices.length === snapshot.notices.length &&
    notices.every((notice, index) => notice === snapshot.notices[index])
  ) {
    return;
  }
  snapshot = { session: activeSession, notices };
  emit();
}

/** AppShell 在渲染期绑定当前仓库会话；epoch 让 A→B→A 的旧令牌失效。 */
export function bindOperationNoticeRepo(repoPath: string | null, sessionKey: RepoId | null = null): void {
  if (activeSession.repoPath === repoPath && activeSession.sessionKey === sessionKey) {
    return;
  }
  activeSession = createSession(repoPath, sessionKey);
  // bind 发生在 React 渲染期，不在这里 emit；useSyncExternalStore 会读取新的稳定快照。
  snapshot = { session: activeSession, notices: [] };
}

/** 兼容既有调用名：返回会话令牌，调用方应原样保存并传回 publishOperationNotice。 */
export function captureOperationNoticeRepoPath(): OperationNoticeSession {
  return activeSession;
}

export function getOperationNoticeSnapshot(): OperationNoticeSnapshot {
  return snapshot;
}

export function subscribeOperationNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isActiveSessionTarget(target: OperationNoticeSession | string | null): boolean {
  if (typeof target === "object" && target !== null) {
    return target === activeSession;
  }
  // 兼容尚未改造、直接传 repoPath 的渐进调用点；捕获过会话的调用点始终走上面的身份比较。
  return target === activeSession.repoPath;
}

export function publishOperationNotice(
  input: OperationNoticeInput,
  repoTarget: OperationNoticeSession | string | null = captureOperationNoticeRepoPath(),
): number {
  if (!isActiveSessionTarget(repoTarget)) {
    return 0;
  }
  const now = Date.now();
  const notice: OperationNotice = {
    ...input,
    id: nextNoticeId++,
    repoPath: activeSession.repoPath,
    sessionKey: activeSession.sessionKey,
    sessionEpoch: activeSession.epoch,
    expiresAt: input.tone === "success" ? now + OPERATION_NOTICE_SUCCESS_TTL_MS : undefined,
    actions: input.actions?.map((action) => ({ ...action })),
  };
  replaceNotices([...snapshot.notices, notice]);
  return notice.id;
}

export function dismissOperationNotice(id: number): void {
  const index = snapshot.notices.findIndex((notice) => notice.id === id);
  if (index < 0) {
    return;
  }
  replaceNotices(snapshot.notices.filter((notice) => notice.id !== id));
}

export function clearOperationNotice(repoTarget?: OperationNoticeSession | string | null): void {
  if (repoTarget !== undefined && !isActiveSessionTarget(repoTarget)) {
    return;
  }
  replaceNotices([]);
}

/** 由成功通知的定时器调用；显式传入时间便于确定性测试。 */
export function expireOperationNotices(now = Date.now()): void {
  replaceNotices(snapshot.notices.filter((notice) => (notice.expiresAt ?? Infinity) > now));
}

const LABEL_KEYS: Partial<Record<WriteKind, string>> = {
  create_commit: "write.labelCreateCommit",
  amend_commit: "write.labelAmendCommit",
  reset: "write.labelReset",
  discard_files: "write.labelDiscardFiles",
  stage_hunk: "write.labelStageHunk",
  unstage_hunk: "write.labelUnstageHunk",
  discard_hunk: "write.labelDiscardHunk",
  stash_save: "write.labelStashSave",
  stash_apply: "write.labelStashApply",
  stash_pop: "write.labelStashPop",
  stash_drop: "write.labelStashDrop",
  fetch: "write.labelFetch",
  pull: "write.labelPull",
  push: "write.labelPush",
  rename_branch: "write.labelRenameBranch",
  create_branch: "write.labelCreateBranch",
  delete_branch: "write.labelDeleteBranch",
  delete_branch_remote: "write.labelDeleteBranchRemote",
  create_tag: "write.labelCreateTag",
  delete_tag: "write.labelDeleteTag",
  delete_tag_remote: "write.labelDeleteTagRemote",
  checkout_remote_branch: "write.labelCheckoutRemoteBranch",
  push_set_upstream: "write.labelPushSetUpstream",
  fetch_prune: "write.labelFetchPrune",
  push_tag: "write.labelPushTag",
};

function writeLabel(kind: WriteKind): string {
  const key = LABEL_KEYS[kind];
  return key ? tLoose(key) : kind;
}

function recoveryActions(
  kind: WriteKind,
  outcome: WriteOutcomeDto,
): OperationNoticeAction[] {
  if (outcome.status === "succeeded" && kind === "create_commit") {
    return [{
      id: "locate-head",
      label: tLoose("notices.locateHead"),
      target: "head",
      oid: outcome.head_oid ?? outcome.args?.oid,
    }];
  }
  if (outcome.status === "succeeded" && (kind === "amend_commit" || kind === "reset")) {
    return [{ id: "open-reflog", label: tLoose("notices.openReflog"), target: "reflog" }];
  }
  if (
    outcome.status === "conflicted" &&
    (kind === "stash_apply" || kind === "stash_pop" || kind === "pull")
  ) {
    return [{ id: "open-conflicts", label: tLoose("notices.openConflicts"), target: "conflicts" }];
  }
  if (outcome.status !== "succeeded" && (kind === "pull" || kind === "push")) {
    return [
      { id: "fetch", label: tLoose("notices.fetch"), target: "remote", operation: "fetch" },
      { id: "pull", label: tLoose("notices.pull"), target: "remote", operation: "pull" },
    ];
  }
  return [];
}

interface WriteNoticeOptions {
  title?: string;
  summary?: string;
  details?: string;
  stderr?: string;
  actions?: OperationNoticeAction[];
}

/** 首批写流程共用：主摘要不放 stderr，恢复动作只描述既有安全入口。 */
export function writeOutcomeNotice(
  kind: WriteKind,
  outcome: WriteOutcomeDto,
  options: WriteNoticeOptions = {},
): OperationNoticeInput {
  const tone: OperationNoticeTone =
    outcome.status === "failed" || outcome.status === "rejected"
      ? "error"
      : outcome.status === "conflicted"
        ? "warning"
        : "success";
  const titleKey =
    tone === "error"
      ? "notices.operationFailedTitle"
      : tone === "warning"
        ? "notices.operationConflictedTitle"
        : "notices.operationSucceededTitle";
  return {
    tone,
    title: options.title ?? tLoose(titleKey, { label: writeLabel(kind) }),
    summary: options.summary ?? outcomeMessage(kind, outcome),
    details: options.details,
    stderr: options.stderr ?? (outcome.stderr?.trim() || undefined),
    actions: options.actions ?? recoveryActions(kind, outcome),
  };
}

export function writeErrorNotice(
  kind: WriteKind,
  message: string,
  stderr?: string,
): OperationNoticeInput {
  const synthetic: WriteOutcomeDto = {
    status: "failed",
    message,
    conflict_files: [],
  };
  return writeOutcomeNotice(kind, synthetic, {
    summary: message,
    stderr,
  });
}

/** 本地删除已成功、远程删除失败：不能把整体误报为完全成功。 */
export function remoteDeletePartialNotice(
  kind: "delete_branch" | "delete_tag",
  localMessage: string,
  remoteMessage: string,
  stderr?: string,
): OperationNoticeInput {
  return {
    tone: "warning",
    title: tLoose("notices.remoteDeletePartialTitle"),
    summary: tLoose("notices.remoteDeletePartialSummary", {
      kind: tLoose(kind === "delete_branch" ? "write.labelDeleteBranch" : "write.labelDeleteTag"),
    }),
    details: [
      tLoose("notices.remoteDeleteLocalResult", { message: localMessage }),
      tLoose("notices.remoteDeleteRemoteResult", { message: remoteMessage }),
    ].join("\n\n"),
    stderr: stderr?.trim() || undefined,
    actions: [],
  };
}
