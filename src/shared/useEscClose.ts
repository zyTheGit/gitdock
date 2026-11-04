import { useEffect, useRef } from "react";
import { consumeEsc } from "./esc";
import { isCapturing } from "./keybindings";

interface EscLayer {
  close: () => void;
  busy: () => boolean;
}

const layers: EscLayer[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") {
    return;
  }
  const layer = layers[layers.length - 1];
  if (!layer || layer.busy() || isCapturing()) {
    return;
  }
  event.preventDefault();
  consumeEsc(event);
  layer.close();
}

function ensureListener() {
  if (!listening) {
    window.addEventListener("keydown", onKeyDown, true);
    listening = true;
  }
}

function releaseListener() {
  if (listening && layers.length === 0) {
    window.removeEventListener("keydown", onKeyDown, true);
    listening = false;
  }
}

/**
 * 弹框 Esc 关闭：按打开顺序维护层栈，只关闭最上层的弹框，并在捕获阶段
 * 标记这次按键已被消费，避免连带触发主视图的退出逻辑。
 *
 * busy 返回 true 时该层让路（例如提交中、写操作执行中）；键位录制期间
 * 同样让路，把 Esc 交还给录制器用于取消录制。
 */
export function useEscClose(onClose: () => void, busy = false) {
  const stateRef = useRef({ onClose, busy });
  stateRef.current = { onClose, busy };

  useEffect(() => {
    const layer: EscLayer = {
      close: () => stateRef.current.onClose(),
      busy: () => stateRef.current.busy,
    };
    layers.push(layer);
    ensureListener();
    return () => {
      const index = layers.lastIndexOf(layer);
      if (index >= 0) {
        layers.splice(index, 1);
      }
      releaseListener();
    };
  }, []);
}
