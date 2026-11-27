import { useSyncExternalStore } from "react";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { UpdateCheckDto, UpdateCheckOutcome, UpdateCheckState } from "../shared/types";

// 「跳过此版本」、自动检查开关与最近检查时间戳放在 localStorage：
// 避免启动后台检查副作用污染 settings.json 里的工具配置。
const SKIPPED_VERSION_KEY = "gitdock.update.skippedVersion";
const LAST_CHECK_KEY = "gitdock.update.lastCheckedAt";
const AUTO_CHECK_KEY = "gitdock.update.autoCheck";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function getAutoUpdateCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_CHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoUpdateCheck(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_CHECK_KEY, enabled ? "1" : "0");
  } catch {
    // 忽略存储异常，当次会话继续正常操作。
  }
}

function checkedWithinInterval(now: number): boolean {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return false;
    const timestamp = Number(raw);
    return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp < CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

function recordLastCheck(now: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    // 忽略隐私模式或配额错误。
  }
}

let state: UpdateCheckState = {
  status: "idle",
  result: null,
  skippedVersion: localStorage.getItem(SKIPPED_VERSION_KEY),
};

const listeners = new Set<() => void>();

function setState(next: UpdateCheckState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** 启动自动检查按 24 小时节流并受开关控制；手动点击不受节流限制。 */
export async function runUpdateCheck(
  options?: { manual?: boolean },
): Promise<UpdateCheckOutcome> {
  const manual = options?.manual ?? false;
  if (state.status === "checking") {
    return { kind: "ignored" };
  }
  const now = Date.now();
  if (!manual && (!getAutoUpdateCheck() || checkedWithinInterval(now))) {
    return { kind: "ignored" };
  }
  setState({ ...state, status: "checking" });
  try {
    const result = await ipc.checkForUpdate();
    recordLastCheck(Date.now());
    setState({ ...state, status: "settled", result });
    return { kind: "checked", result };
  } catch (error) {
    // 保留上一次成功结果：网络抖动不该让已经发现的更新凭空消失。
    setState({ ...state, status: "failed" });
    return { kind: "failed", message: errorMessage(error) };
  }
}

/** 有待更新且用户没有跳过该版本时才提示；两处 UI 共用这一条判断。 */
export function pendingUpdate(snapshot: UpdateCheckState): UpdateCheckDto | null {
  const result = snapshot.result;
  if (!result || !result.available) {
    return null;
  }
  return result.latest_version === snapshot.skippedVersion ? null : result;
}

export function skipAvailableUpdate() {
  const available = pendingUpdate(state)?.latest_version;
  if (!available) {
    return;
  }
  localStorage.setItem(SKIPPED_VERSION_KEY, available);
  setState({ ...state, skippedVersion: available });
}

/** 跳过的提示只针对这一个版本；撤销后它重新成为待更新项。 */
export function clearSkippedUpdate() {
  if (!state.skippedVersion) {
    return;
  }
  localStorage.removeItem(SKIPPED_VERSION_KEY);
  setState({ ...state, skippedVersion: null });
}

/** 打开最近一次检查拿到的 Release 页：正常更新与“版本号被误标”两种提示共用。 */
export async function openReleasePage(): Promise<UpdateCheckOutcome> {
  const result = state.result;
  if (!result) {
    return { kind: "ignored" };
  }
  try {
    await ipc.openReleasePage(result.page_url);
    return { kind: "checked", result };
  } catch (error) {
    return { kind: "failed", message: errorMessage(error) };
  }
}

export function useUpdateCheck(): UpdateCheckState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

function errorMessage(error: unknown): string {
  // CommandError 携带 i18n key 时按当前语言翻译；其余按 Error.message。
  return error instanceof Error ? errorText(error) : String(error);
}
