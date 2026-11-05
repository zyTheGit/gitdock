import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { copyText } from "../../shared/clipboard";
import { errorText } from "../../shared/error";
import { formatDateTimeWithSeconds } from "../../shared/format";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { CommandLogEntryDto } from "../../shared/types";

interface CommandLogDialogProps {
  onClose: () => void;
}

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
 * Git 命令日志：应用级诊断数据，打开与手动刷新都拉一次快照，不经 generation。
 * 后端为内存环形缓冲（上限 500 条），Dialog 场景直接渲染，不做虚拟化。
 */
export function CommandLogDialog({ onClose }: CommandLogDialogProps) {
  const { t } = useI18n();
  useEscClose(onClose);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  const total = entries?.length ?? 0;
  const failedCount = entries?.filter((entry) => !entry.success).length ?? 0;
  const filtering = normalizedQuery.length > 0 || failedOnly;

  const refreshLabel = refreshing
    ? t("gitlog.refreshing")
    : refreshDone
      ? t("gitlog.refreshed")
      : t("gitlog.refresh");

  return (
    <Modal className="gitlog-dialog">
      <header>
        <div>
          <h2>{t("gitlog.dialogTitle")}</h2>
          <p className="muted settings-hint">{t("gitlog.dialogSubtitle")}</p>
          {entries !== null && (
            <p className="gitlog-stats">
              {t("gitlog.stats", { total, failed: failedCount })}
              {filtering && (
                <> · {t("gitlog.statsFiltered", { visible: visible.length })}</>
              )}
            </p>
          )}
        </div>
        <div className="gitlog-header-actions">
          <button type="button" className="gitlog-refresh" onClick={() => void load(true)} disabled={refreshing}>
            <Icon name="refresh" className={refreshing ? "gitlog-spin" : undefined} />
            <span>{refreshLabel}</span>
          </button>
          <button className="detail-close" onClick={onClose} aria-label={t("gitlog.closeAria")}>
            ×
          </button>
        </div>
      </header>

      <div className="gitlog-filter-row">
        <div className="gitlog-search-wrap">
          <input
            className="ref-input gitlog-search"
            type="search"
            value={query}
            disabled={entries === null}
            placeholder={t("gitlog.searchPlaceholder")}
            aria-label={t("gitlog.searchAria")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="gitlog-search-clear"
              onClick={() => setQuery("")}
              aria-label={t("gitlog.clearSearch")}
              title={t("gitlog.clearSearch")}
            >
              ×
            </button>
          )}
        </div>
        <label className="gitlog-filter">
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(event) => setFailedOnly(event.target.checked)}
          />
          {t("gitlog.filterFailed")}
        </label>
        <button
          type="button"
          className={confirmClear ? "gitlog-clear danger" : "gitlog-clear"}
          title={t("gitlog.clearHint")}
          disabled={entries === null || entries.length === 0}
          onClick={() => void clearLog()}
        >
          <Icon name="trash" />
          <span>{confirmClear ? t("gitlog.confirmClear") : t("gitlog.clear")}</span>
        </button>
      </div>

      {loadError && (
        <p className="gitlog-error" role="alert">
          {loadError}
        </p>
      )}

      {entries !== null && visible.length === 0 && (
        <p className="muted gitlog-empty">
          {entries.length === 0 ? t("gitlog.empty") : t("gitlog.noMatches")}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="gitlog-list">
          {visible.map((entry) => (
            <li key={entry.id} className={entry.success ? "gitlog-row" : "gitlog-row failed"}>
              <div className="gitlog-row-line">
                <button
                  type="button"
                  className="gitlog-row-main"
                  aria-expanded={expandedId === entry.id}
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <span className={entry.success ? "gitlog-badge ok" : "gitlog-badge fail"}>
                    {entry.success ? t("gitlog.successBadge") : t("gitlog.failedBadge")}
                  </span>
                  <span className="mono gitlog-command">{commandText(entry)}</span>
                  <span className="gitlog-duration">{formatDuration(entry.duration_ms)}</span>
                  <span className="gitlog-exit">
                    {t("gitlog.exitCodeLabel")}:{" "}
                    {entry.exit_code ?? t("gitlog.launchFailed")}
                  </span>
                  <span className="gitlog-chevron" aria-hidden="true">
                    <Icon name="chevronDown" />
                  </span>
                </button>
                <button
                  type="button"
                  className={copiedId === entry.id ? "gitlog-copy copied" : "gitlog-copy"}
                  onClick={() => void copyCommand(entry)}
                  title={copiedId === entry.id ? t("gitlog.copied") : t("gitlog.copyCommand")}
                  aria-label={t("gitlog.copyCommandAria", { command: commandText(entry) })}
                >
                  <Icon name="copy" />
                </button>
              </div>
              {expandedId === entry.id && (
                <dl className="gitlog-detail">
                  <dt>{t("gitlog.cwdLabel")}</dt>
                  <dd className="mono gitlog-cwd">
                    <span className="gitlog-cwd-text">{entry.cwd || "—"}</span>
                    {entry.cwd && (
                      <button
                        type="button"
                        className={
                          copiedCwdId === entry.id ? "gitlog-copy-path copied" : "gitlog-copy-path"
                        }
                        onClick={() => void copyEntryCwd(entry)}
                        title={copiedCwdId === entry.id ? t("gitlog.copied") : t("gitlog.copyPath")}
                        aria-label={t("gitlog.copyPath")}
                      >
                        <Icon name="copy" />
                      </button>
                    )}
                  </dd>
                  <dt>{t("gitlog.startedAtLabel")}</dt>
                  <dd>{formatDateTimeWithSeconds(entry.started_at_ms)}</dd>
                  <dt>{t("gitlog.stderrLabel")}</dt>
                  <dd>
                    {entry.stderr_head ? (
                      <pre className="gitlog-stderr">{entry.stderr_head}</pre>
                    ) : (
                      <span className="muted">{t("gitlog.noStderr")}</span>
                    )}
                  </dd>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}