import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real local stack.
 *
 * These run against local Supabase with the imported workbook already applied,
 * so they assert on real records rather than fixtures. That is the point: the
 * unit suites prove the parser, and these prove the parsed data survives all
 * the way to the screen.
 *
 * Prerequisites: `supabase start` and the workbook import applied.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    // Vite binds IPv6 localhost; 127.0.0.1 does not answer.
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @training/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
