import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isEscConsumed } from "../../shared/esc";
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
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "enter") {
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

  return (
    <section className={fullscreen ? "terminal-panel fullscreen" : "terminal-panel"} style={fullscreen ? undefined : { height }} hidden={!visible}>
      <div
        className="terminal-resizer"
        role="separator"
        aria-orientation="horizontal"
        title="拖动调整终端高度"
        onPointerDown={startResize}
      />
      <header className="terminal-header">
        <div className="terminal-title">
          <strong>终端</strong>
          <span className="terminal-path" title={repoPath}>
            {repoPath}
          </span>
          <span className="terminal-permission">以当前用户权限运行</span>
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
                    ? "未找到 LazyGit，请先安装或在设置中配置路径"
                    : "在当前仓库启动 LazyGit"
                }
              >
                启动 LazyGit
              </button>
              <button className="terminal-launch-button secondary" onClick={() => start("shell")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="m7 9 3 3-3 3m6 0h4" /></svg>
                <span>启动 Shell</span>
              </button>
            </>
          ) : (
            <button onClick={end} disabled={status === "starting"}>
              结束进程
            </button>
          )}
          <button className="terminal-fullscreen-button" onClick={() => setFullscreen((current) => !current)} title={fullscreen ? "还原终端（Ctrl+Shift+Enter）" : "全屏终端（Ctrl+Shift+Enter）"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {fullscreen ? <path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5" /> : <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />}
            </svg>
            <span>{fullscreen ? "还原" : "全屏"}</span>
          </button>
          <button
            className="terminal-icon-button"
            onClick={onCollapse}
            aria-label="收起终端"
            title={`收起面板；终端进程继续运行，可用 ${terminalShortcut} 恢复`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </header>
      {lazygitMissing && restartable && (
        <div className="terminal-notice">
          未找到 LazyGit：可运行 <code>winget install JesseDuffield.lazygit</code> 安装，或在设置中填写
          可执行文件路径；Shell 不受影响。
          <button className="link" onClick={onOpenSettings}>
            打开设置
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
