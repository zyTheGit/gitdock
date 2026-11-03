import { useI18n } from "../i18n";
import type { AppInfoDto, RepoStateDto, SettingsDto } from "../shared/types";

export interface StatusBarProps {
  busy: boolean;
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  fontScale: number;
  terminalOpen: boolean;
  terminalRunning: boolean;
  terminalShortcut: string;
  updateVersion: string | null;
  onOpenCommandLog: () => void;
  onToggleTerminal: () => void;
  onOpenUpdate: () => void;
}

function TerminalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
    </svg>
  );
}

function CommandLogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

export function StatusBar({
  busy,
  repo,
  info,
  settings,
  fontScale,
  terminalOpen,
  terminalRunning,
  terminalShortcut,
  updateVersion,
  onOpenCommandLog,
  onToggleTerminal,
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
          className="gitlog-status-button"
          onClick={onOpenCommandLog}
          aria-label={t("gitlog.openButtonTitle")}
          title={t("gitlog.openButtonTitle")}
        >
          <CommandLogIcon />
        </button>
        {repo && (
          <button
            className={terminalOpen ? "terminal-status-button active" : "terminal-status-button"}
            onClick={onToggleTerminal}
            aria-label={terminalOpen ? t("shell.collapseTerminal") : t("shell.openTerminal")}
            aria-pressed={terminalOpen}
            title={
              terminalOpen
                ? t("shell.collapseTerminalTitle", { shortcut: terminalShortcut })
                : t("shell.openTerminalTitle", { shortcut: terminalShortcut })
            }
          >
            <TerminalIcon />
            {terminalRunning && <span className="terminal-status-dot" aria-hidden="true" />}
          </button>
        )}
      </span>
    </footer>
  );
}
