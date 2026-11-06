import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../../i18n";
import { copyText } from "../../shared/clipboard";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { CommandLogEntryDto } from "../../shared/types";

/** 耗时展示：不足 1 秒以毫秒计，满 1 秒折算为秒并保留 1 位小数。 */
function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** 快照内新条目在后；按 id 倒序让最新命令排在最前。 */
function latestFirst(entries: CommandLogEntryDto[]): CommandLogEntryDto[] {
  return [...entries].sort((a, b) => b.id - a.id);
}

/** 完整命令行；复制与展示共用同一份拼接结果。 */
function commandText(entry: CommandLogEntryDto): string {
  return ["git", ...entry.args].join(" ");
}

/**
 * 命令日志状态（ADR-0023 面板化）：快照加载、搜索、失败筛选、清空与复制反馈。
 * 日志是应用级诊断数据，打开与手动刷新都拉一次快照，不经 generation；
 * 切换标签保留搜索与筛选状态，重新激活标签时重拉快照。
 */
export function useCommandLog(active: boolean) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<CommandLogEntryDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedCwdId, setCopiedCwdId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const refreshTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const cwdTimer = useRef<number | undefined>(undefined);
  const clearTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
      setRefreshDone(false);
    }
    try {
      setEntries(latestFirst(await ipc.gitCommandLog()));
      setLoadError(null);
      if (manual) {
        setRefreshDone(true);
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => setRefreshDone(false), 1500);
      }
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      if (manual) {
        setRefreshing(false);
      }
    }
  }, []);

  const copyCommand = useCallback(
    async (entry: CommandLogEntryDto) => {
      const ok = await copyText(commandText(entry));
      if (!ok) {
        setLoadError(t("gitlog.copyFailed"));
        return;
      }
      setCopiedId(entry.id);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
    },
    [t]
  );

  const copyEntryCwd = useCallback(
    async (entry: CommandLogEntryDto) => {
      if (!entry.cwd) {
        return;
      }
      const ok = await copyText(entry.cwd);
      if (!ok) {
        setLoadError(t("gitlog.copyFailed"));
        return;
      }
      setCopiedCwdId(entry.id);
      window.clearTimeout(cwdTimer.current);
      cwdTimer.current = window.setTimeout(() => setCopiedCwdId(null), 1500);
    },
    [t]
  );

  const clearLog = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    window.clearTimeout(clearTimer.current);
    try {
      await ipc.clearCommandLog();
      setEntries([]);
      setLoadError(null);
      setConfirmClear(false);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [confirmClear]);

  // 标签激活（含首次挂载后）时拉一次快照；收起期间不轮询。
  useEffect(() => {
    if (active) {
      void load();
    }
  }, [active, load]);

  // 实时刷新：日志标签激活期间订阅 gitlog://changed（Rust 每条命令入队后发出），
  // 收到即重拉快照；loadPending 去重并发请求，避免批量写操作时请求堆积。
  const loadPendingRef = useRef(false);
  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("gitlog://changed", () => {
      if (disposed || loadPendingRef.current) {
        return;
      }
      loadPendingRef.current = true;
      void load().finally(() => {
        loadPendingRef.current = false;
      });
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, load]);

  useEffect(
    () => () => {
      window.clearTimeout(refreshTimer.current);
      window.clearTimeout(copyTimer.current);
      window.clearTimeout(cwdTimer.current);
      window.clearTimeout(clearTimer.current);
    },
    []
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visible =
    entries === null
      ? []
      : entries
          .filter((entry) => !failedOnly || !entry.success)
          .filter((entry) => {
            if (!normalizedQuery) {
              return true;
            }
            const haystack = `${commandText(entry)} ${entry.cwd} ${entry.stderr_head ?? ""}`;
            return haystack.toLowerCase().includes(normalizedQuery);
          });

  return {
    entries,
    loadError,
    failedOnly,
    setFailedOnly,
    expandedId,
    setExpandedId,
    refreshing,
    refreshDone,
    copiedId,
    copiedCwdId,
    query,
    setQuery,
    confirmClear,
    load,
    copyCommand,
    copyEntryCwd,
    clearLog,
    visible,
    formatDuration,
    commandText,
  };
}