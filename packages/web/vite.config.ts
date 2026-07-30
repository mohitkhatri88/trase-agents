import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // SSE through a dev proxy buffers unless changeOrigin is set and
      // compression is off. Verify with a live run, not just a page load —
      // a buffered stream looks exactly like a frozen UI.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
