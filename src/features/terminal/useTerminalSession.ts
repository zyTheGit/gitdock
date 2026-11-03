import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { i18next } from "../../i18n";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { TerminalEvent } from "../../shared/types";

export type TerminalMode = "lazygit" | "shell";
export type TerminalStatus = "idle" | "starting" | "running" | "exited" | "failed";

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

/** useTerminalSession 的入参：仓库上下文、面板可见性与宿主回调。 */
export interface TerminalSessionParams {
  repoPath: string;
  visible: boolean;
  /** 设置中的 LazyGit 路径；变化后重新探测能力，无需重启应用。 */
  lazygitConfig: string;
  onRunningChange: (running: boolean) => void;
  onRepoChanged: () => void;
}

/** useTerminalSession 对外暴露的会话状态与操作句柄。 */
export interface TerminalSessionState {
  /** 绑定到终端容器 div 的 ref，作为 xterm 的挂载宿主。 */
  hostRef: RefObject<HTMLDivElement>;
  /** 当前模式；null 表示尚未启动会话。 */
  mode: TerminalMode | null;
  /** 会话状态机：idle → starting → running → exited/failed。 */
  status: TerminalStatus;
  /** 面向用户的错误文案；null 表示无错误。 */
  message: string | null;
  /** lazygit 可执行路径探测结果：undefined=探测中，null=未找到。 */
  lazygitPath: string | null | undefined;
  /** 启动（或重启）指定模式的会话。 */
  start: (mode: TerminalMode) => void;
  /** 结束当前进程并回到未启动状态。 */
  end: () => void;
  /** 聚焦当前 xterm 视图（若存在）。 */
  focus: () => void;
}

/**
 * 终端会话 hook：封装 xterm 实例装配（Terminal + FitAddon）与 Rust 侧 PTY
 * 生命周期（open/write/resize/close）。xterm.js 只负责渲染与按键，PTY 与
 * 子进程全部由 Rust 侧管理；收起面板只隐藏视图，进程继续运行。
 */
export function useTerminalSession({
  repoPath,
  visible,
  lazygitConfig,
  onRunningChange,
  onRepoChanged,
}: TerminalSessionParams): TerminalSessionState {
  const [mode, setMode] = useState<TerminalMode | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [lazygitPath, setLazygitPath] = useState<string | null | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const repoRef = useRef(repoPath);
  const statusRef = useRef<TerminalStatus>("idle");
  const modeRef = useRef<TerminalMode | null>(null);

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

      // 防御旧回调：新会话启动后，旧 term 的事件一律丢弃。
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
            term.write(
              `\r\n\x1b[90m${i18next.t("terminal.processExited", { code: event.code })}\x1b[0m\r\n`,
            );
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

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { hostRef, mode, status, message, lazygitPath, start, end, focus };
}