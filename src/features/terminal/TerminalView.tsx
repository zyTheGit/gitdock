import { useState } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import { currentPlatform } from "../../shared/platform";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { SettingsDto } from "../../shared/types";
import { ShellProfileSelect, type ShellProfile } from "./ShellProfileSelect";
import { useTerminalSession } from "./useTerminalSession";
import "../../styles/terminal.css";

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
  const [switchError, setSwitchError] = useState<string | null>(null);

  const { hostRef, mode, status, message, lazygitPath, gitBashPath, start, end, focus } =
    useTerminalSession({
      repoPath,
      visible,
      lazygitConfig,
      onRunningChange,
      onRepoChanged,
    });

  const restartable = mode === null || status === "exited" || status === "failed";
  const lazygitMissing = lazygitPath === null;
  const lazygitRunning = mode === "lazygit" && (status === "starting" || status === "running");
  const shellRunning = mode === "shell" && (status === "starting" || status === "running");
  const isWindows = currentPlatform() === "windows";
  const installCmd =
    currentPlatform() === "windows"
      ? t("terminal.lazygitInstallWindows")
      : currentPlatform() === "macos"
        ? t("terminal.lazygitInstallMac")
        : t("terminal.lazygitInstallLinux");

  // Shell 下拉（仅 Windows）：先持久化，成功后仅在 Shell 模式下重启会话；
  // LazyGit 运行中由组件禁用，未启动时只保存、下次启动生效。
  const applyShellProfile = (next: ShellProfile) => {
    setSwitchError(null);
    void ipc
      .setShellProfile(next)
      .then((saved) => {
        onShellProfileSaved(saved);
        if (mode === "shell") {
          start("shell");
        }
      })
      .catch((err) => {
        setSwitchError(t("terminal.shellSwitchFailed", { error: errorText(err) }));
      });
  };

  return (
    <div className="terminal-view">
      <header className="terminal-header">
        <div className="terminal-title">
          <strong>{t("terminal.title")}</strong>
          <span className="terminal-path" title={repoPath}>
            {repoPath}
          </span>
          <span className="terminal-permission">{t("terminal.permissionNote")}</span>
        </div>
        <div className="terminal-actions">
          {isWindows && (
            <ShellProfileSelect
              shellProfile={shellProfile}
              gitBashPath={gitBashPath}
              disabled={lazygitRunning}
              needConfirm={shellRunning}
              onApply={applyShellProfile}
            />
          )}
          {restartable ? (
            <>
              <button
                className="primary terminal-launch-button"
                onClick={() => start("lazygit")}
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
              <button className="terminal-launch-button secondary" onClick={() => start("shell")}>
                <Icon name="shell" />
                <span>{t("terminal.launchShell")}</span>
              </button>
            </>
          ) : (
            <button
              className="terminal-launch-button danger"
              onClick={end}
              disabled={status === "starting"}
              title={t("terminal.endProcessTitle")}
            >
              <Icon name="stop" />
              <span>{t("terminal.endProcess")}</span>
            </button>
          )}
        </div>
      </header>
      {lazygitMissing && restartable && (
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
      {message && <div className="terminal-error">{message}</div>}
      <div className="terminal-body" ref={hostRef} onMouseDown={() => focus()} />
    </div>
  );
}