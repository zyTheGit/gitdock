import type { AppInfoDto, RepoStateDto, SettingsDto } from "../shared/types";

interface StatusBarProps {
  busy: boolean;
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  fontScale: number;
  terminalOpen: boolean;
  terminalRunning: boolean;
  onToggleTerminal: () => void;
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

export function StatusBar({
  busy,
  repo,
  info,
  settings,
  fontScale,
  terminalOpen,
  terminalRunning,
  onToggleTerminal,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>{busy ? "处理中…" : repo ? "就绪" : "未打开仓库"}</span>
      <span className="statusbar-right">
        <span className="mono">
          {info ? `git ${info.git_version ?? "未知"} · ${info.platform}` : ""}
          {repo && settings ? ` · ${settings.watch_enabled ? "监听已开启" : "监听已关闭"}` : ""}
          {` · 缩放 ${Math.round(fontScale * 100)}%`}
        </span>
        {repo && (
          <button
            className={terminalOpen ? "terminal-status-button active" : "terminal-status-button"}
            onClick={onToggleTerminal}
            aria-label={terminalOpen ? "收起终端" : "打开终端"}
            aria-pressed={terminalOpen}
            title={
              terminalOpen
                ? "收起终端（Ctrl+`）；进程继续运行"
                : "打开终端（Ctrl+`）"
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
