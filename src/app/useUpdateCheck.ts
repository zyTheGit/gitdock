import { useSyncExternalStore } from "react";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { UpdateCheckDto, UpdateCheckOutcome, UpdateCheckState } from "../shared/types";

// 「跳过此版本」放在 localStorage：settings.json 的保存会连带重写工具配置，
// 一次后台网络检查不该产生那种副作用。
const SKIPPED_VERSION_KEY = "gitdock.update.skippedVersion";

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

/** 启动时由 App 调用一次；不做时间节流，否则重启后在窗口期内看不到新版本。 */
export async function runUpdateCheck(): Promise<UpdateCheckOutcome> {
  if (state.status === "checking") {
    return { kind: "ignored" };
  }
  setState({ ...state, status: "checking" });
  try {
    const result = await ipc.checkForUpdate();
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
