import { Icon } from "../assets/icons";
import { useI18n } from "../i18n";
import type { AppInfoDto, RepoStateDto, SettingsDto } from "../shared/types";

export interface StatusBarProps {
  busy: boolean;
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  fontScale: number;
  /** 底部面板打开且终端标签活动；按钮按下则收起面板，否则切到终端标签。 */
  terminalActive: boolean;
  logActive: boolean;
  terminalRunning: boolean;
  terminalShortcut: string;
  updateVersion: string | null;
  onToggleTerminal: () => void;
  onToggleCommandLog: () => void;
  onOpenUpdate: () => void;
}

export function StatusBar({
  busy,
  repo,
  info,
  settings,
  fontScale,
  terminalActive,
  logActive,
  terminalRunning,
  terminalShortcut,
  updateVersion,
  onToggleTerminal,
  onToggleCommandLog,
  onOpenUpdate,
}: StatusBarProps) {
  const { t } = useI18n();
  return (
    <footer className="statusbar">
      <span>{busy ? t("shell.busy") : repo ? t("shell.ready") : t("shell.noRepository")}</span>
      <span className="statusbar-right">
        <span className="mono">
          {info ? `git ${info.git_version ?? t("shell.unknown")} · ${info.platform}` : ""}
          {repo && settings ? ` · ${settings.watch_enabled ? t("shell.watchEnabled") : t("shell.watchDisabled")}` : ""}
          {` · ${t("shell.zoomLevel", { n: Math.round(fontScale * 100) })}`}
        </span>
        {updateVersion && (
          <button
            className="update-status-chip"
            onClick={onOpenUpdate}
            aria-label={t("shell.updateAvailableTitle", { version: updateVersion })}
            title={t("shell.updateAvailableTitle", { version: updateVersion })}
          >
            <span className="update-status-dot" aria-hidden="true" />
            {t("shell.updateAvailable")}
          </button>
        )}
        <button
          className={logActive ? "gitlog-status-button active" : "gitlog-status-button"}
          onClick={onToggleCommandLog}
          aria-label={t("gitlog.openButtonTitle")}
          title={logActive ? t("shell.collapsePanel") : t("gitlog.openButtonTitle")}
          aria-pressed={logActive}
        >
          <Icon name="commandLog" />
        </button>
        {repo && (
          <button
            className={terminalActive ? "terminal-status-button active" : "terminal-status-button"}
            onClick={onToggleTerminal}
            aria-label={terminalActive ? t("shell.collapseTerminal") : t("shell.openTerminal")}
            aria-pressed={terminalActive}
            title={
              terminalActive
                ? t("shell.collapseTerminalTitle", { shortcut: terminalShortcut })
                : t("shell.openTerminalTitle", { shortcut: terminalShortcut })
            }
          >
            <Icon name="terminalStatus" />
            {terminalRunning && <span className="terminal-status-dot" aria-hidden="true" />}
          </button>
        )}
      </span>
    </footer>
  );
}
