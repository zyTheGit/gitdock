import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 需要固定端口；前端只通过 command seam 访问 Git。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/dist/**"] },
  },
  build: {
    target: "chrome105",
    sourcemap: false,
  },
});
