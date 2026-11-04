import { defineConfig } from "@playwright/test";
import "dotenv/config";

const PORT = 3100;
// E2E uses its own durable SQLite file so it never touches demo data.
const env = { ...process.env, DATABASE_URL: "file:./data/e2e.db", WORKER_RESTART_MS: "15000", INSECURE_COOKIES: "1", PORT: String(PORT) } as Record<string, string>;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `node scripts/e2e-reset.mjs && npx concurrently -k "npx next start -p ${PORT}" "npm:service" "npm:orchestrator" "npm:worker:a" "npm:worker:b"`,
    url: `http://localhost:${PORT}/api/workers`,
    timeout: 180_000,
    reuseExistingServer: false,
    env,
  },
});
