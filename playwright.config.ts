import { defineConfig } from "@playwright/test";
import "dotenv/config";
import crypto from "node:crypto";

const PORT = 3100;
// E2E is hermetic: its own SQLite file, and it can never spend or call paid APIs.
// - OPERATOR_PRIVATE_KEY: a fresh random key with no funds (x402 is blocked before signing)
// - MONAD_ESCROW_ADDRESS empty (escrow shown as BLOCKED)
// - LLM_API_KEY empty (rule-based planner; no live LLM calls)
const env = {
  ...process.env,
  DATABASE_URL: "file:./data/e2e.db",
  WORKER_RESTART_MS: "15000",
  INSECURE_COOKIES: "1",
  PORT: String(PORT),
  OPERATOR_PRIVATE_KEY: "0x" + crypto.randomBytes(32).toString("hex"),
  MONAD_ESCROW_ADDRESS: "",
  LLM_API_KEY: "",
} as Record<string, string>;

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
