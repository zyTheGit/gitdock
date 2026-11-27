import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stubUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

// Node 直接加载 TS 时无法解析前端目录导入；只替换通知/写流程的运行时依赖，
// 被测 store 与锁辅助函数仍是仓库中的真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/src/app/operationNotice.ts")) {
      if (specifier === "../i18n") {
        return {
          url: stubUrl("export function tLoose(key, options = {}) { return Object.entries(options).reduce((text, [name, value]) => text.replaceAll('{{' + name + '}}', String(value)), key); }"),
          shortCircuit: true,
        };
      }
      if (specifier === "../features/write/messages") {
        return {
          url: stubUrl("export function outcomeMessage(_kind, outcome) { return outcome.message; }"),
          shortCircuit: true,
        };
      }
    }
    if (context.parentURL?.endsWith("/src/app/useWriteFlow.ts")) {
      if (specifier === "react") {
        return {
          url: stubUrl([
            "export const useCallback = () => {};",
            "export const useEffect = () => {};",
            "export const useRef = () => {};",
            "export const useState = () => {};",
          ].join("\n")),
          shortCircuit: true,
        };
      }
      if (specifier === "../features/write/messages") {
        return {
          url: stubUrl("export function outcomeMessage() { return ''; }"),
          shortCircuit: true,
        };
      }
      if (specifier === "../shared/error") {
        return {
          url: stubUrl("export function errorText(error) { return String(error); } export function outcomeText() { return ''; }"),
          shortCircuit: true,
        };
      }
      if (specifier === "../shared/ipc") {
        return {
          url: stubUrl("export const ipc = {}; export const activeIpcRepoId = () => null;"),
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  OPERATION_NOTICE_SUCCESS_TTL_MS,
  bindOperationNoticeRepo,
  captureOperationNoticeRepoPath,
  clearOperationNotice,
  dismissOperationNotice,
  expireOperationNotices,
  getOperationNoticeSnapshot,
  publishOperationNotice,
  remoteDeletePartialNotice,
  writeOutcomeNotice,
} = await import("./operationNotice.ts");
const { acquireWriteFlowLock, releaseWriteFlowLock } = await import("./useWriteFlow.ts");

function input(tone, summary, overrides = {}) {
  return { tone, title: summary, summary, ...overrides };
}

function summaries() {
  return getOperationNoticeSnapshot().notices.map((notice) => notice.summary);
}

test("success expires at 4500ms while warnings remain", () => {
  bindOperationNoticeRepo("/repo-success", 1);
  const successId = publishOperationNotice(input("success", "success"));
  publishOperationNotice(input("warning", "warning"));
  const success = getOperationNoticeSnapshot().notices.find((notice) => notice.id === successId);

  assert.equal(OPERATION_NOTICE_SUCCESS_TTL_MS, 4500);
  assert.equal(typeof success?.expiresAt, "number");
  assert.equal(getOperationNoticeSnapshot(), getOperationNoticeSnapshot());

  expireOperationNotices(success.expiresAt - 1);
  assert.deepEqual(summaries(), ["success", "warning"]);
  expireOperationNotices(success.expiresAt);
  assert.deepEqual(summaries(), ["warning"]);
  expireOperationNotices(Number.MAX_SAFE_INTEGER);
  assert.deepEqual(summaries(), ["warning"]);
});

test("new errors and warnings append without overwriting earlier notices", () => {
  bindOperationNoticeRepo("/repo-errors", 2);
  publishOperationNotice(input("error", "first", { stderr: "first stderr" }));
  publishOperationNotice(input("error", "second", { stderr: "second stderr" }));
  publishOperationNotice(input("warning", "third"));

  assert.deepEqual(summaries(), ["first", "second", "third"]);
  assert.deepEqual(
    getOperationNoticeSnapshot().notices.map((notice) => notice.stderr),
    ["first stderr", "second stderr", undefined],
  );
});

test("dismiss removes only the requested id and keeps snapshots stable on no-op", () => {
  bindOperationNoticeRepo("/repo-dismiss", 3);
  const firstId = publishOperationNotice(input("error", "first"));
  const secondId = publishOperationNotice(input("error", "second"));

  dismissOperationNotice(firstId);
  assert.deepEqual(summaries(), ["second"]);
  const current = getOperationNoticeSnapshot();
  dismissOperationNotice(firstId);
  assert.equal(getOperationNoticeSnapshot(), current);
  dismissOperationNotice(secondId);
  assert.deepEqual(summaries(), []);
});

test("repository sessions clear on path or session-key changes", () => {
  bindOperationNoticeRepo("/same-path", 10);
  publishOperationNotice(input("error", "old session"));
  bindOperationNoticeRepo("/same-path", 11);
  assert.deepEqual(summaries(), []);

  publishOperationNotice(input("error", "current session"));
  bindOperationNoticeRepo("/other-path", 12);
  assert.deepEqual(summaries(), []);

  publishOperationNotice(input("error", "other session"));
  clearOperationNotice("/other-path");
  assert.deepEqual(summaries(), []);
});

test("A to B to A rejects results captured by the old A session", () => {
  bindOperationNoticeRepo("/repo-a", 20);
  const oldA = captureOperationNoticeRepoPath();
  assert.equal(captureOperationNoticeRepoPath(), oldA);
  bindOperationNoticeRepo("/repo-b", 21);
  bindOperationNoticeRepo("/repo-a", 20);

  assert.equal(publishOperationNotice(input("error", "stale A"), oldA), 0);
  assert.deepEqual(summaries(), []);
  assert.ok(publishOperationNotice(input("error", "fresh A")) > 0);
  assert.deepEqual(summaries(), ["fresh A"]);
});

test("stderr and recovery actions survive notice construction and queue cloning", () => {
  bindOperationNoticeRepo("/repo-recovery", 30);
  const noticeInput = writeOutcomeNotice("pull", {
    status: "failed",
    message: "non-fast-forward",
    conflict_files: [],
    stderr: "  rejected by remote\n",
  });
  const originalFetchLabel = noticeInput.actions[0].label;
  publishOperationNotice(noticeInput);
  noticeInput.actions[0].label = "mutated";

  const [notice] = getOperationNoticeSnapshot().notices;
  assert.equal(notice.stderr, "rejected by remote");
  assert.equal(notice.tone, "error");
  assert.deepEqual(
    notice.actions.map((action) => [action.target, action.operation]),
    [["remote", "fetch"], ["remote", "pull"]],
  );
  assert.equal(notice.actions[0].label, originalFetchLabel);

  const partial = remoteDeletePartialNotice("delete_branch", "local ok", "remote failed", " remote stderr ");
  assert.equal(partial.tone, "warning");
  assert.equal(partial.stderr, "remote stderr");
  assert.equal(
    partial.details,
    "notices.remoteDeleteLocalResult\n\nnotices.remoteDeleteRemoteResult",
  );
});

test("write-flow ref lock rejects same-tick reentry and releases only its owner", () => {
  const lock = { current: null };
  const owner = acquireWriteFlowLock(lock);
  assert.equal(typeof owner, "symbol");
  assert.equal(acquireWriteFlowLock(lock), null);

  releaseWriteFlowLock(lock, Symbol("not-owner"));
  assert.notEqual(lock.current, null);
  assert.equal(acquireWriteFlowLock(lock), null);

  releaseWriteFlowLock(lock, owner);
  assert.equal(lock.current, null);
  assert.equal(typeof acquireWriteFlowLock(lock), "symbol");
});
