import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;

// A throwaway database per run, so tests never inherit state from a previous
// run or from the developer's own dev database.
const dataDir = mkdtempSync(join(tmpdir(), "trase-e2e-"));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // one server, one SQLite file, one writer
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Builds and serves the real production artifact: one Node process serving
  // both the API and the built React bundle. Not a dev server — this is what
  // actually ships.
  webServer: {
    command: "pnpm build && node packages/server/dist/index.js",
    cwd: join(import.meta.dirname, "../.."),
    url: `${BASE_URL}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL: `file:${join(dataDir, "e2e.db")}`,
      WEB_DIST: "packages/web/dist",
      // Seed the deterministic fixture agents alongside the demo data.
      TRASE_E2E: "1",
      // Compress simulated work so a four-step run finishes in ~50ms of real
      // time while still exercising the genuine async path — real timers, real
      // streaming, real ordering. Nothing is stubbed.
      TRASE_SPEED: "0.02",
    },
  },
});
