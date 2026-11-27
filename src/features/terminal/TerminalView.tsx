import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import { currentPlatform } from "../../shared/platform";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { SettingsDto } from "../../shared/types";
import { ShellProfileSelect, type ShellProfile } from "./ShellProfileSelect";
import { useTerminalSession, type TerminalMode } from "./useTerminalSession";
import "../../styles/terminal.css";

const TERMINAL_TAB_STORAGE_KEY = "gitdock.terminal.lastMode";

function readStoredTerminalTab(): TerminalMode {
  try {
    return localStorage.getItem(TERMINAL_TAB_STORAGE_KEY) === "shell" ? "shell" : "lazygit";
  } catch {
    return "lazygit";
  }
}

interface TerminalViewProps {
  repoPath: string;
  /** 面板打开且终端标签处于活动状态；隐藏期间 PTY 继续运行。 */
  visible: boolean;
  /** 设置中的 LazyGit 路径；变化后重新探测能力，无需重启应用。 */
  lazygitConfig: string;
  /** 当前持久化的 Shell 选择（ADR-0023：面板内切换，即时生效）。 */
  shellProfile: ShellProfile;
  /** Shell 切换保存成功后回写全局设置（接收最新 SettingsDto）。 */
  onShellProfileSaved: (settings: SettingsDto) => void;
  onOpenSettings: () => void;
  onRunningChange: (running: boolean) => void;
  onRepoChanged: () => void;
}

/**
 * 底部面板的终端内容视图（ADR-0023）：工具栏（LazyGit/Shell 启停、Shell 下拉）、
 * 路径与权限提示、lazygit 安装指引与 xterm 宿主。
 * 外框（标签栏、高度拖拽、全屏、收起）由 BottomPanel 承担；
 * xterm 实例与 PTY 会话生命周期见 useTerminalSession。
 */
export function TerminalView({
  repoPath,
  visible,
  lazygitConfig,
  shellProfile,
  onShellProfileSaved,
  onOpenSettings,
  onRunningChange,
  onRepoChanged,
}: TerminalViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TerminalMode>(readStoredTerminalTab);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [lazygitActive, setLazygitActive] = useState(false);
  const [shellActive, setShellActive] = useState(false);

  const lazygitSession = useTerminalSession({
    repoPath,
    visible: visible && activeTab === "lazygit",
    lazygitConfig,
    onRunningChange: setLazygitActive,
    onRepoChanged,
  });
  const shellSession = useTerminalSession({
    repoPath,
    visible: visible && activeTab === "shell",
    lazygitConfig,
    onRunningChange: setShellActive,
    onRepoChanged,
  });

  useEffect(() => {
    onRunningChange(lazygitActive || shellActive);
  }, [lazygitActive, shellActive, onRunningChange]);

  const selectTab = (next: TerminalMode) => {
    setActiveTab(next);
    try {
      localStorage.setItem(TERMINAL_TAB_STORAGE_KEY, next);
    } catch {
      // 忽略存储不可用情况，保持本次会话切换有效。
    }
  };

  const session = activeTab === "lazygit" ? lazygitSession : shellSession;
  const restartable =
    session.mode === null || session.status === "exited" || session.status === "failed";
  const lazygitMissing = lazygitSession.lazygitPath === null;
  const shellRunning =
    shellSession.mode === "shell" &&
    (shellSession.status === "starting" || shellSession.status === "running");
  const isWindows = currentPlatform() === "windows";
  const installCmd =
    currentPlatform() === "windows"
      ? t("terminal.lazygitInstallWindows")
      : currentPlatform() === "macos"
        ? t("terminal.lazygitInstallMac")
        : t("terminal.lazygitInstallLinux");

  // Shell 下拉（仅 Windows）：先持久化，仅在 Shell 进程运行中才立即提示重启，与 LazyGit 会话解耦。
  const applyShellProfile = (next: ShellProfile) => {
    setSwitchError(null);
    void ipc
      .setShellProfile(next)
      .then((saved) => {
        onShellProfileSaved(saved);
        if (shellSession.mode === "shell") {
          shellSession.start("shell");
        }
      })
      .catch((err) => {
        setSwitchError(t("terminal.shellSwitchFailed", { error: errorText(err) }));
      });
  };

  return (
    <div className="terminal-view">
      <header className="terminal-header">
        <div className="terminal-subtabs" role="tablist" aria-label={t("terminal.subtabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "lazygit"}
            className={activeTab === "lazygit" ? "terminal-subtab active" : "terminal-subtab"}
            onClick={() => selectTab("lazygit")}
          >
            <span>{t("terminal.subtabLazygit")}</span>
            {lazygitActive && <span className="terminal-subtab-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "shell"}
            className={activeTab === "shell" ? "terminal-subtab active" : "terminal-subtab"}
            onClick={() => selectTab("shell")}
          >
            <span>{t("terminal.subtabShell")}</span>
            {shellActive && <span className="terminal-subtab-dot" aria-hidden="true" />}
          </button>
        </div>
        <div className="terminal-title">
          <span className="terminal-path" title={repoPath}>
            {repoPath}
          </span>
          <span className="terminal-permission">{t("terminal.permissionNote")}</span>
        </div>
        <div className="terminal-actions">
          {isWindows && activeTab === "shell" && (
            <ShellProfileSelect
              shellProfile={shellProfile}
              gitBashPath={shellSession.gitBashPath}
              disabled={false}
              needConfirm={shellRunning}
              onApply={applyShellProfile}
            />
          )}
          {restartable ? (
            activeTab === "lazygit" ? (
              <button
                className="primary terminal-launch-button"
                onClick={() => lazygitSession.start("lazygit")}
                disabled={lazygitMissing}
                title={
                  lazygitMissing
                    ? t("terminal.lazygitMissingTitle")
                    : t("terminal.launchLazygitTitle")
                }
              >
                <Icon name="play" />
                <span>{t("terminal.launchLazygit")}</span>
              </button>
            ) : (
              <button
                className="primary terminal-launch-button"
                onClick={() => shellSession.start("shell")}
              >
                <Icon name="shell" />
                <span>{t("terminal.launchShell")}</span>
              </button>
            )
          ) : (
            <button
              className="terminal-launch-button danger"
              onClick={session.end}
              disabled={session.status === "starting"}
              title={t("terminal.endProcessTitle")}
            >
              <Icon name="stop" />
              <span>{t("terminal.endProcess")}</span>
            </button>
          )}
        </div>
      </header>
      {activeTab === "lazygit" && lazygitMissing && restartable && (
        <div className="terminal-notice">
          {t("terminal.lazygitNoticePrefix")}
          <code>{installCmd}</code>
          {t("terminal.lazygitNoticeSuffix")}
          <button className="link" onClick={onOpenSettings}>
            {t("terminal.openSettings")}
          </button>
        </div>
      )}
      {switchError && <div className="terminal-error">{switchError}</div>}
      {session.message && <div className="terminal-error">{session.message}</div>}
      <div
        className="terminal-body"
        hidden={activeTab !== "lazygit"}
        ref={lazygitSession.hostRef}
        onMouseDown={() => lazygitSession.focus()}
      />
      <div
        className="terminal-body"
        hidden={activeTab !== "shell"}
        ref={shellSession.hostRef}
        onMouseDown={() => shellSession.focus()}
      />
    </div>
  );
}