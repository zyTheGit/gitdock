import { useSyncExternalStore } from "react";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { UpdateCheckDto, UpdateCheckOutcome, UpdateCheckState } from "../shared/types";

// 检查节流与「跳过此版本」放在 localStorage：settings.json 的保存会连带重写工具
// 配置，一次后台网络检查不该产生那种副作用。
const LAST_CHECKED_KEY = "gitdock.update.lastCheckedAt";
const SKIPPED_VERSION_KEY = "gitdock.update.skippedVersion";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;


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

/** 距上次成功检查不足 24 小时时跳过自动检查；手动检查不受限。 */
function recentlyChecked(): boolean {
  const last = Number(localStorage.getItem(LAST_CHECKED_KEY));
  return Number.isFinite(last) && last > 0 && Date.now() - last < CHECK_INTERVAL_MS;
}

export async function runUpdateCheck(force = false): Promise<UpdateCheckOutcome> {
  if (state.status === "checking") {
    return { kind: "throttled" };
  }
  if (!force && recentlyChecked()) {
    return { kind: "throttled" };
  }
  setState({ ...state, status: "checking" });
  try {
    const result = await ipc.checkForUpdate();
    localStorage.setItem(LAST_CHECKED_KEY, String(Date.now()));
    setState({ ...state, status: "settled", result });
    return { kind: "checked", result };
  } catch (error) {
    // 保留上一次成功结果：网络抖动不该让已经发现的更新凭空消失，
    // 下一次自动检查还要等 24 小时。
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

export async function openAvailableUpdate(): Promise<UpdateCheckOutcome> {
  const result = pendingUpdate(state);
  if (!result) {
    return { kind: "throttled" };
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
