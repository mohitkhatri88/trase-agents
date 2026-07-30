import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Follows PORT so `PORT=3999 pnpm dev` doesn't leave the UI proxying
      // to a port nothing is listening on.
      //
      // SSE through a dev proxy needs changeOrigin, and must not be buffered.
      // Verify with a live run rather than a page load — a buffered stream
      // looks exactly like a frozen UI.
      "/api": {
        target: process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
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
