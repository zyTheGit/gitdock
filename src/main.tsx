import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import { ipc } from "./shared/ipc";
import "./styles.css";

const savedTheme = localStorage.getItem("gitdock.theme");
if (savedTheme === "light" || savedTheme === "dark") {
  document.documentElement.dataset.theme = savedTheme;
}

// 语言在首帧前同步就绪：本地镜像保证不闪变，settings.json 的权威值由 App 启动后校正。
initI18n();

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
