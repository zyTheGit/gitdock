import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorText } from "../shared/error";
import { CommandError, ipc } from "../shared/ipc";
import type {
  UpdateDownloadProgressDto,
  UpdateDownloadState,
  UpdateInstallDto,
} from "../shared/types";

const INITIAL_STATE: UpdateDownloadState = {
  status: "idle",
  version: null,
  downloadedBytes: 0,
  totalBytes: null,
  result: null,
  error: null,
  installing: false,
  installNotice: null,
};

let state: UpdateDownloadState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();
let listenerRegistered = false;

function setState(next: UpdateDownloadState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function ensureProgressListener() {
  if (listenerRegistered) {
    return;
  }
  listenerRegistered = true;
  void listen<UpdateDownloadProgressDto>("update-download-progress", (event) => {
    const payload = event.payload;
    if (state.status !== "downloading" && state.status !== "verifying") {
      return;
    }
    setState({
      ...state,
      version: payload.version,
      status: payload.phase,
      downloadedBytes: payload.downloaded_bytes,
      totalBytes: payload.total_bytes ?? state.totalBytes,
    });
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export async function startUpdateDownload(version?: string, totalBytes?: number | null): Promise<void> {
  if (state.status === "downloading" || state.status === "verifying") {
    return;
  }
  ensureProgressListener();
  setState({
    ...INITIAL_STATE,
    status: "downloading",
    version: version ?? null,
    totalBytes: totalBytes ?? null,
  });
  try {
    const result = await ipc.downloadUpdate();
    setState({
      ...state,
      status: "ready",
      version: result.version,
      downloadedBytes: result.size,
      totalBytes: result.size,
      result,
      error: null,
    });
  } catch (error) {
    const cancelled =
      error instanceof CommandError &&
      (error.code === "canceled" || error.key === "errors.updateDownloadCancelled");
    if (cancelled) {
      setState({
        ...INITIAL_STATE,
        status: "cancelled",
        version: version ?? null,
      });
      return;
    }
    setState({
      ...state,
      status: "failed",
      error: error instanceof Error ? errorText(error) : String(error),
    });
  }
}

export async function cancelUpdateDownload(): Promise<void> {
  if (state.status !== "downloading" && state.status !== "verifying") {
    return;
  }
  try {
    await ipc.cancelUpdateDownload();
  } catch {
    // 忽略取消指令传输异常；主下载 Future 结束时会同步复位状态。
  }
}

export async function installDownloadedUpdate(): Promise<UpdateInstallDto | null> {
  if (state.status !== "ready" || state.installing) {
    return null;
  }
  setState({ ...state, installing: true, installNotice: null, error: null });
  try {
    const outcome = await ipc.installDownloadedUpdate();
    setState({ ...state, installing: false });
    return outcome;
  } catch (error) {
    setState({
      ...state,
      installing: false,
      error: error instanceof Error ? errorText(error) : String(error),
    });
    return null;
  }
}

export async function revealDownloadedUpdate(): Promise<string | null> {
  try {
    await ipc.revealDownloadedUpdate();
    return null;
  } catch (error) {
    return error instanceof Error ? errorText(error) : String(error);
  }
}

export function setUpdateInstallNotice(notice: string | null): void {
  setState({ ...state, installNotice: notice });
}

export function useUpdateDownload(): UpdateDownloadState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
