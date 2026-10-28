import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// One command (`npm test` in tests/e2e) seeds a fresh demo, starts the API and a production build of the UI,
// then runs every spec. Ports differ from the dev defaults so a running dev setup is left alone.
const root = join(__dirname, "..", "..");
const apiPort = process.env.VAULT_E2E_API_PORT ?? "8100";
const webPort = process.env.VAULT_E2E_WEB_PORT ?? "3100";
const venvPython = [join(root, ".venv", "Scripts", "python.exe"), join(root, ".venv", "bin", "python")].find(existsSync);
const python = process.env.VAULT_PYTHON ?? venvPython ?? "python";

export default defineConfig({
  testDir: "./specs",
  // Specs share one seeded database and some of them change it (approving a proposal), so run in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /phone.spec.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /phone\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `"${python}" serve_api.py`,
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npm run build && npx next start -p ${webPort}`,
      cwd: join(root, "frontend"),
      url: `http://localhost:${webPort}`,
      timeout: 400_000,
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_VAULT_API: `http://127.0.0.1:${apiPort}`, VAULT_NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
