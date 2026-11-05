import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { formatDateTimeWithSeconds } from "../../shared/format";
import type { CommandLogEntryDto } from "../../shared/types";
import { useCommandLog } from "./useCommandLog";


interface CommandLogViewProps {
  /** 底部面板打开且命令日志标签处于活动状态；重新激活时重拉快照。 */
  active: boolean;
}

/**
 * 底部面板的命令日志内容视图（ADR-0023）：搜索、失败筛选、刷新、两段确认
 * 清空、单条展开与复制。数据是应用级内存环形缓冲快照，不做虚拟化。
 * 状态与加载逻辑见 useCommandLog；切换标签保留筛选与展开状态。
 */
export function CommandLogView({ active }: CommandLogViewProps) {
  const { t } = useI18n();
  const {
    entries,
    loadError,
    failedOnly,
    setFailedOnly,
    expandedId,
    setExpandedId,
    refreshing,
    refreshDone,
    query,
    setQuery,
    confirmClear,
    copiedId,
    copiedCwdId,
    load,
    copyCommand,
    copyEntryCwd,
    clearLog,
    visible,
    formatDuration,
    commandText,
  } = useCommandLog(active);

  const total = entries?.length ?? 0;
  const failedCount = entries?.filter((entry) => !entry.success).length ?? 0;
  const filtering = query.trim().length > 0 || failedOnly;

  const refreshLabel = refreshing
    ? t("gitlog.refreshing")
    : refreshDone
      ? t("gitlog.refreshed")
      : t("gitlog.refresh");

  return (
    <div className="gitlog-view">
      <header className="gitlog-header">
        <div className="gitlog-header-info">
          <span className="gitlog-stats">
            {t("gitlog.stats", { total, failed: failedCount })}
            {filtering && (
              <> · {t("gitlog.statsFiltered", { visible: visible.length })}</>
            )}
          </span>
          <span className="muted gitlog-subtitle">{t("gitlog.dialogSubtitle")}</span>
        </div>
        <div className="gitlog-header-actions">
          <button type="button" className="gitlog-refresh" onClick={() => void load(true)} disabled={refreshing}>
            <Icon name="refresh" className={refreshing ? "gitlog-spin" : undefined} />
            <span>{refreshLabel}</span>
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
          {visible.map((entry: CommandLogEntryDto) => (
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
    </div>
  );
}