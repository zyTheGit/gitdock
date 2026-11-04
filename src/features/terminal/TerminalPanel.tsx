import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isEscConsumed } from "../../shared/esc";
import { currentPlatform, primaryModifierLabel } from "../../shared/platform";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import { useTerminalSession } from "./useTerminalSession";
import "../../styles/terminal.css";

const HEIGHT_KEY = "gitdock.terminal.height";
const MIN_HEIGHT = 140;

function readHeight(): number {
  const stored = Number(localStorage.getItem(HEIGHT_KEY));
  return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : 280;
}

interface TerminalPanelProps {
  repoPath: string;
  visible: boolean;
  /** 设置中的 LazyGit 路径；变化后重新探测能力，无需重启应用。 */
  lazygitConfig: string;
  /** 终端开合的当前键位，只用于提示文案。 */
  terminalShortcut: string;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onRunningChange: (running: boolean) => void;
  onRepoChanged: () => void;
}

/**
 * 底部终端的装配组件：容器、拖拽把手、工具条按钮与全屏/Esc 的 UI 分支；
 * xterm 实例与 PTY 会话生命周期（open/write/resize/close）见 useTerminalSession。
 * xterm.js 只负责渲染与按键，PTY 与子进程全部由 Rust 侧管理；收起面板只隐藏
 * 视图，进程继续运行；结束进程是独立动作。
 */
export function TerminalPanel({
  repoPath,
  visible,
  lazygitConfig,
  terminalShortcut,
  onCollapse,
  onOpenSettings,
  onRunningChange,
  onRepoChanged,
}: TerminalPanelProps) {
  const { t } = useI18n();
  const [height, setHeight] = useState(readHeight);
  const [fullscreen, setFullscreen] = useState(false);

  const { hostRef, mode, status, message, lazygitPath, start, end, focus } = useTerminalSession({
    repoPath,
    visible,
    lazygitConfig,
    onRunningChange,
    onRepoChanged,
  });

  // 高度落盘与面板宽度同一策略：拖动中只进内存，抬手/取消时写一次，卸载兜底。
  const heightRef = useRef(height);
  const heightDirtyRef = useRef(false);

  const persistHeight = useCallback(() => {
    if (!heightDirtyRef.current) {
      return;
    }
    heightDirtyRef.current = false;
    localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
  }, []);

  // 卸载兜底：拖拽中途切视图/关窗口也保住最新高度。
  useEffect(() => persistHeight, [persistHeight]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 放大 diff 已消费的 Esc 不再还原终端全屏，一次按键只退出一层。
      if (event.key === "Escape" && fullscreen && !isEscConsumed(event)) {
        setFullscreen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "enter") {
        event.preventDefault();
        setFullscreen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, fullscreen]);

  useEffect(() => {
    if (!visible) setFullscreen(false);
  }, [visible]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    // 拖动中只 setState 保持跟手，最新高度记进 ref，抬手/取消时统一落盘。
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight + (startY - move.clientY), MIN_HEIGHT),
        Math.max(window.innerHeight - 240, MIN_HEIGHT),
      );
      heightRef.current = next;
      heightDirtyRef.current = true;
      setHeight(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      persistHeight();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const restartable = mode === null || status === "exited" || status === "failed";
  const lazygitMissing = lazygitPath === null;
  const modifier = primaryModifierLabel();
  const installCmd =
    currentPlatform() === "windows"
      ? t("terminal.lazygitInstallWindows")
      : currentPlatform() === "macos"
        ? t("terminal.lazygitInstallMac")
        : t("terminal.lazygitInstallLinux");
  const fullscreenTitle = fullscreen
    ? t("terminal.restoreFullscreen", { modifier })
    : t("terminal.enterFullscreen", { modifier });

  return (
    <section className={fullscreen ? "terminal-panel fullscreen" : "terminal-panel"} style={fullscreen ? undefined : { height }} hidden={!visible}>
      <div
        className="terminal-resizer"
        role="separator"
        aria-orientation="horizontal"
        title={t("terminal.resizeHint")}
        onPointerDown={startResize}
      />
      <header className="terminal-header">
        <div className="terminal-title">
          <strong>{t("terminal.title")}</strong>
          <span className="terminal-path" title={repoPath}>
            {repoPath}
          </span>
          <span className="terminal-permission">{t("terminal.permissionNote")}</span>
        </div>
        <div className="terminal-actions">
          {restartable ? (
            <>
              <button
                className="primary"
                onClick={() => start("lazygit")}
                disabled={lazygitMissing}
                title={
                  lazygitMissing
                    ? t("terminal.lazygitMissingTitle")
                    : t("terminal.launchLazygitTitle")
                }
              >
                {t("terminal.launchLazygit")}
              </button>
              <button className="terminal-launch-button secondary" onClick={() => start("shell")}>
                <Icon name="shell" />
                <span>{t("terminal.launchShell")}</span>
              </button>
            </>
          ) : (
            <button onClick={end} disabled={status === "starting"}>
              {t("terminal.endProcess")}
            </button>
          )}
          <button className="terminal-fullscreen-button" onClick={() => setFullscreen((current) => !current)} title={fullscreenTitle}>
            <Icon name={fullscreen ? "fullscreenRestore" : "fullscreen"} />
            <span>{fullscreen ? t("terminal.restore") : t("terminal.fullscreen")}</span>
          </button>
          <button
            className="terminal-icon-button"
            onClick={onCollapse}
            aria-label={t("terminal.collapseLabel")}
            title={t("terminal.collapseTitle", { shortcut: terminalShortcut })}
          >
            <Icon name="collapse" />
          </button>
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
      {message && <div className="terminal-error">{message}</div>}
      <div
        className="terminal-body"
        ref={hostRef}
        onMouseDown={() => focus()}
      />
    </section>
  );
}
