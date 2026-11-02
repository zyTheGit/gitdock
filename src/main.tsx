import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ipc } from "./shared/ipc";
import "./styles.css";

const savedTheme = localStorage.getItem("gitdock.theme");
if (savedTheme === "light" || savedTheme === "dark") {
  document.documentElement.dataset.theme = savedTheme;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 等 React 首帧绘制完成再显示窗口：主窗口在配置里是隐藏的，这样启动时既不会
// 先按默认尺寸闪一下，也不会露出 WebView2 未绘制前的白底。
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void ipc.uiReady().catch(() => undefined);
  });
});
