import { expect, test } from "@playwright/test";
import "dotenv/config";

const TOKEN = process.env.OPERATOR_ACCESS_TOKEN!;

test.describe("API authorization", () => {
  test("mutating endpoints reject requests without an operator session", async ({ request }) => {
    expect((await request.post("/api/workflows", { data: { goal: "x".repeat(20), budget: {} } })).status()).toBe(401);
    expect((await request.post("/api/workflows/wf_x/inject-failure")).status()).toBe(401);
    expect((await request.post("/api/workflows/wf_x/start")).status()).toBe(401);
    expect((await request.post("/api/workflows/wf_x/settle")).status()).toBe(401);
    expect((await request.post("/api/session", { data: { token: "wrong" } })).status()).toBe(401);
  });

  test("budgets above server ceilings are rejected", async ({ request }) => {
    expect((await request.post("/api/session", { data: { token: TOKEN } })).ok()).toBeTruthy();
    const r = await request.post("/api/workflows", {
      data: { goal: "Research the Monad ecosystem please", budget: { x402Usdc: 100, perCallUsdc: 50, approvalThresholdUsdc: 1, escrowMon: 5, gasMon: 1 } },
    });
    expect(r.status()).toBe(400);
  });

  test("network status reports the verified Monad testnet chain and x402 support", async ({ request }) => {
    const s = await (await request.get("/api/network/status")).json();
    expect(s.chain.rpcChainId).toBe(10143);
    expect(s.chain.match).toBe(true);
    expect(s.x402.network).toBe("eip155:10143");
    expect(s.x402.exactSupported).toBe(true);
  });
});

test("full workflow: plan -> approve with failure drill -> crash -> checkpoint failover -> verified briefing", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Operator access token").fill(TOKEN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Workflow Studio" })).toBeVisible();

  // Both worker processes are online in the registry.
  await expect(page.getByText("Worker A · Research")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("text=ONLINE").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect(page).toHaveURL(/\/workflows\/wf_/, { timeout: 60_000 });
  await expect(page.getByText("Review draft and approve")).toBeVisible();
  await expect(page.getByText(/^planner: Rule-based/)).toBeVisible();
  await expect(page.getByText("No payment or escrow operations yet — this is a draft.")).toBeVisible();
  await expect(page.getByText("Gather Monad ecosystem evidence").first()).toBeVisible();

  // Failure drill is on by default; approve.
  await page.getByRole("button", { name: "Approve & start" }).click();

  await expect(page.getByText(/Injected failure: Worker A/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/lease expired/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/claimed recovery attempt #2 from checkpoint/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Loaded checkpoint seq/)).toBeVisible();
  await expect(page.getByText(/Policy rejected x402 purchase: amount 250000 exceeds per-call cap/)).toBeVisible({ timeout: 60_000 });

  await expect(page.getByRole("link", { name: "View briefing" })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("Recovery handoff")).toBeVisible();
  await expect(page.getByText("Worker B resumed", { exact: true })).toBeVisible();
  await expect(page.getByText("BLOCKED · NOT CHARGED")).toBeVisible();
  await page.screenshot({ path: "test-results/execution-view.png", fullPage: true });

  await page.getByRole("link", { name: "View briefing" }).click();
  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible();
  await expect(page.getByText("all verification checks passed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" }).first()).toBeVisible();
  await expect(page.getByText("RECOVERY").first()).toBeVisible();
  await page.screenshot({ path: "test-results/result-view.png", fullPage: true });

  const id = page.url().match(/workflows\/(wf_[a-f0-9]+)/)![1];
  const md = await page.request.get(`/api/workflows/${id}/result?format=md`);
  expect(md.ok()).toBeTruthy();
  const text = await md.text();
  expect(text).toContain("## Executive Summary");
  expect(md.headers()["x-content-sha256"]).toMatch(/^0x[0-9a-f]{64}$/);
});
