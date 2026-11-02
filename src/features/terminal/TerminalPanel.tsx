import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { TerminalEvent } from "../../shared/types";
import "../../styles/terminal.css";

type TerminalMode = "lazygit" | "shell";
type Status = "idle" | "starting" | "running" | "exited" | "failed";

const HEIGHT_KEY = "gitdock.terminal.height";
const MIN_HEIGHT = 140;

function readHeight(): number {
  const stored = Number(localStorage.getItem(HEIGHT_KEY));
  return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : 280;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface TerminalPanelProps {
  repoPath: string;
  visible: boolean;
  /** 设置中的 LazyGit 路径；变化后重新探测能力，无需重启应用。 */
  lazygitConfig: string;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onRunningChange: (running: boolean) => void;
  onRepoChanged: () => void;
}

/**
 * 底部终端：xterm.js 只负责渲染与按键，PTY 与子进程全部由 Rust 侧管理。
 * 收起面板只隐藏视图，进程继续运行；结束进程是独立动作。
 */
export function TerminalPanel({
  repoPath,
  visible,
  lazygitConfig,
  onCollapse,
  onOpenSettings,
  onRunningChange,
  onRepoChanged,
}: TerminalPanelProps) {
  const [height, setHeight] = useState(readHeight);
  const [mode, setMode] = useState<TerminalMode | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [lazygitPath, setLazygitPath] = useState<string | null | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const repoRef = useRef(repoPath);
  const statusRef = useRef<Status>("idle");
  const modeRef = useRef<TerminalMode | null>(null);

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(height));
  }, [height]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let disposed = false;
    setLazygitPath(undefined);
    void ipc
      .terminalCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setLazygitPath(capabilities.lazygit_path ?? null);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLazygitPath(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [lazygitConfig]);

  useEffect(() => {
    onRunningChange(status === "starting" || status === "running");
  }, [status, onRunningChange]);

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }
    fitRef.current?.fit();
  }, []);

  const stop = useCallback(() => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id !== null) {
      void ipc.terminalClose(id).catch(() => undefined);
    }
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
  }, []);

  // 卸载（切仓库/关窗口）才结束进程；收起面板不会触发这里。
  useEffect(() => stop, [stop]);
  useEffect(() => () => onRunningChange(false), [onRunningChange]);

  // 面板不按仓库路径重新挂载；切仓库时 Rust 已结束旧会话，这里清空视图并提示。
  useEffect(() => {
    if (repoRef.current === repoPath) {
      return;
    }
    const wasRunning =
      modeRef.current !== null ||
      statusRef.current === "starting" ||
      statusRef.current === "running";
    repoRef.current = repoPath;
    stop();
    hostRef.current?.replaceChildren();
    setMode(null);
    setStatus("idle");
    setMessage(null);
    onRunningChange(false);
    if (wasRunning) {
      onRepoChanged();
    }
  }, [repoPath, stop, onRunningChange, onRepoChanged]);

  // 重新显示时隐藏期间尺寸为 0，必须重新 fit 并恢复焦点。
  useEffect(() => {
    if (!visible) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, fit]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fullscreen) {
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

  const start = useCallback(
    (nextMode: TerminalMode) => {
      const host = hostRef.current;
      if (!host) {
        return;
      }
      stop();
      setMode(nextMode);
      setStatus("starting");
      setMessage(null);
      host.replaceChildren();

      const term = new XTerm({
        fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(host);
      termRef.current = term;
      fitRef.current = fitAddon;

      const isCurrent = () => termRef.current === term;

      term.onData((data) => {
        const id = sessionRef.current;
        if (id === null || !isCurrent()) {
          return;
        }
        void ipc
          .terminalWrite(id, bytesToBase64(new TextEncoder().encode(data)))
          .catch((err) => setMessage(errorText(err)));
      });
      term.onResize(({ cols, rows }) => {
        const id = sessionRef.current;
        if (id !== null) {
          void ipc.terminalResize(id, cols, rows).catch(() => undefined);
        }
      });

      requestAnimationFrame(() => {
        if (!isCurrent()) {
          return;
        }
        fit();
        const channel = new Channel<TerminalEvent>();
        channel.onmessage = (event) => {
          if (!isCurrent()) {
            return;
          }
          if (event.kind === "data") {
            term.write(base64ToBytes(event.data));
          } else {
            term.write(`\r\n\x1b[90m[进程已退出，代码 ${event.code}]\x1b[0m\r\n`);
            sessionRef.current = null;
            setStatus("exited");
          }
        };
        ipc
          .terminalOpen(nextMode, term.cols, term.rows, channel)
          .then((id) => {
            if (!isCurrent()) {
              void ipc.terminalClose(id).catch(() => undefined);
              return;
            }
            sessionRef.current = id;
            setStatus("running");
            term.focus();
          })
          .catch((err) => {
            setMessage(errorText(err));
            setStatus("failed");
          });
      });
    },
    [fit, stop],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new ResizeObserver(() => fit());
    observer.observe(host);
    return () => observer.disconnect();
  }, [fit]);

  const end = () => {
    stop();
    setMode(null);
    setStatus("idle");
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight + (startY - move.clientY), MIN_HEIGHT),
        Math.max(window.innerHeight - 240, MIN_HEIGHT),
      );
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
            title="收起面板；终端进程继续运行，可用 Ctrl+` 恢复"
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
        onMouseDown={() => termRef.current?.focus()}
      />
    </section>
  );
}
