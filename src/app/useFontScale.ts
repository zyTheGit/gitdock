import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { errorText } from "../shared/error";
import { ipc } from "../shared/ipc";
import type { SettingsDto } from "../shared/types";

/** 与 ADR 0003 一致的固定档位；快捷键只在档位间跳转。 */
export const ZOOM_STEPS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const MIN = ZOOM_STEPS[0];
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function normalizeFontScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX, Math.max(MIN, value));
}

function stepFontScale(current: number, direction: 1 | -1): number {
  const value = normalizeFontScale(current);
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > value + 1e-9) ?? MAX;
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < value - 1e-9) ?? MIN;
}

interface FontScaleOptions {
  settings: SettingsDto | null;
  setSettings: (settings: SettingsDto) => void;
  onError: (message: string) => void;
}

/**
 * 整体缩放 WebView。缩放立即生效，持久化失败只提示，不回退当前比例。
 * 全局快捷键在捕获阶段处理，优先于终端和输入框。
 */
export function useFontScale({ settings, setSettings, onError }: FontScaleOptions) {
  const [fontScale, setFontScale] = useState(() =>
    normalizeFontScale(settings?.font_scale),
  );
  const settingsRef = useRef(settings);
  const scaleRef = useRef(fontScale);
  const requestSeq = useRef(0);
  settingsRef.current = settings;
  scaleRef.current = fontScale;

  useEffect(() => {
    if (!settings) {
      return;
    }
    const stored = normalizeFontScale(settings.font_scale);
    if (stored !== scaleRef.current) {
      scaleRef.current = stored;
      setFontScale(stored);
    }
  }, [settings]);

  useEffect(() => {
    void getCurrentWebview().setZoom(fontScale);
  }, [fontScale]);

  const apply = useCallback(
    (next: number) => {
      const scale = normalizeFontScale(next);
      scaleRef.current = scale;
      setFontScale(scale);
      const current = settingsRef.current;
      if (!current) {
        return;
      }
      const requestId = ++requestSeq.current;
      void ipc
        .saveSettings({ ...current, font_scale: scale })
        .then((saved) => {
          // 连续按键时只接受最后一次保存结果，避免旧响应覆盖新比例。
          if (requestId === requestSeq.current) {
            setSettings(saved);
          }
        })
        .catch((err) => onError(errorText(err)));
    },
    [onError, setSettings],
  );

  const zoomIn = useCallback(() => apply(stepFontScale(scaleRef.current, 1)), [apply]);
  const zoomOut = useCallback(() => apply(stepFontScale(scaleRef.current, -1)), [apply]);
  const resetZoom = useCallback(() => apply(1), [apply]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const key = event.key;
      if (key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      // 主键盘与小键盘的加号在不同布局下报 "=" / "+" / "Add"。
      if (key === "=" || key === "+" || key === "Add") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (key === "-" || key === "_" || key === "Subtract") {
        event.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [resetZoom, zoomIn, zoomOut]);

  return { fontScale, zoomIn, zoomOut, resetZoom };
}
