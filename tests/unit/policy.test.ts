import { beforeEach, describe, expect, it } from "vitest";
import { budgetSummary, committedSpend, reservePayment, updatePayment, type PaymentRequirementLike } from "../../src/server/policy";
import { activeWorkflow, freshDb } from "./helpers";
import type { DB } from "../../src/server/db";

const PAY_TO = "0x6cCC8A2fB675ecf7b4324e334773b95843818787";
const ASSET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const req = (amount: string, over: Partial<PaymentRequirementLike> = {}): PaymentRequirementLike => ({
  scheme: "exact",
  network: "eip155:10143",
  asset: ASSET,
  amount,
  payTo: PAY_TO,
  ...over,
});
const URL_OK = "http://localhost:4021/v1/monad/ecosystem";

let db: DB;
let wf: string;
const reserve = (key: string, r: PaymentRequirementLike, url = URL_OK, max = 20_000n) =>
  reservePayment({ workflowId: wf, taskId: "research", idempotencyKey: key, providerId: "synapse-data", resourceUrl: url, requirement: r, taskMaxUsdcBase: max }, db);

beforeEach(async () => {
  db = freshDb();
  wf = await activeWorkflow(db);
});

describe("policy engine", () => {
  it("approves an in-policy purchase and reserves it", () => {
    const r = reserve("k1", req("10000"));
    expect(r.decision).toBe("APPROVED");
    expect(r.op.status).toBe("RESERVED");
    expect(committedSpend(wf, db)).toBe(10000n);
  });

  it("duplicate requests with the same idempotency key never create a second charge", () => {
    const a = reserve("same", req("10000"));
    const b = reserve("same", req("10000"));
    expect(b.decision).toBe("DUPLICATE");
    expect(b.op.id).toBe(a.op.id);
    expect(committedSpend(wf, db)).toBe(10000n);
    expect((db.prepare(`SELECT COUNT(*) c FROM payment_operations`).get() as { c: number }).c).toBe(1);
  });

  it("rejects amounts above the per-call cap before any signature", () => {
    const r = reserve("deep", req("250000"), "http://localhost:4021/v1/monad/deep-dive", 10n ** 9n);
    expect(r.decision).toBe("REJECTED");
    expect(r.op.status).toBe("REJECTED");
    expect(r.decision === "REJECTED" && r.reason).toMatch(/per-call cap/);
    expect(committedSpend(wf, db)).toBe(0n);
  });

  it("rejects overspending once the total budget is exhausted", () => {
    // cap 0.05 USDC; per-call 0.02; threshold 0.015 -> use 0.015 each
    expect(reserve("a", req("15000")).decision).toBe("APPROVED");
    expect(reserve("b", req("15000")).decision).toBe("APPROVED");
    expect(reserve("c", req("15000")).decision).toBe("APPROVED");
    const d = reserve("d", req("15000"));
    expect(d.decision).toBe("REJECTED");
    expect(d.decision === "REJECTED" && d.reason).toMatch(/budget exhausted/);
  });

  it("rejects wrong network, asset, payee, scheme and non-allowlisted resources", () => {
    expect(reserve("n", req("1000", { network: "eip155:84532" })).decision).toBe("REJECTED");
    expect(reserve("n2", req("1000", { network: "eip155:143" })).decision).toBe("REJECTED"); // mainnet
    expect(reserve("as", req("1000", { asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" })).decision).toBe("REJECTED");
    expect(reserve("pt", req("1000", { payTo: "0x000000000000000000000000000000000000dEaD" })).decision).toBe("REJECTED");
    expect(reserve("sc", req("1000", { scheme: "upto" })).decision).toBe("REJECTED");
    expect(reserve("url", req("1000"), "http://evil.example/v1/monad/ecosystem").decision).toBe("REJECTED");
    expect(committedSpend(wf, db)).toBe(0n);
  });

  it("requires approval above the threshold unless pre-approved", () => {
    expect(reserve("hv", req("18000")).decision).toBe("REJECTED");
    const b = JSON.parse((db.prepare(`SELECT budget_json FROM workflows WHERE id=?`).get(wf) as { budget_json: string }).budget_json);
    b.highValueApproved = true;
    db.prepare(`UPDATE workflows SET budget_json=? WHERE id=?`).run(JSON.stringify(b), wf);
    expect(reserve("hv", req("18000")).decision).toBe("APPROVED");
  });

  it("enforces the task-level max cost", () => {
    expect(reserve("t", req("10000"), URL_OK, 5000n).decision).toBe("REJECTED");
  });

  it("failed payments release budget and may be retried under the same key", () => {
    const a = reserve("f", req("10000"));
    updatePayment(a.op.id, { status: "FAILED", status_reason: "provider error" }, db);
    expect(committedSpend(wf, db)).toBe(0n);
    const b = reserve("f", req("10000"));
    expect(b.decision).toBe("APPROVED");
    expect(b.op.id).toBe(a.op.id);
  });

  it("separates estimated, reserved, confirmed and released amounts (never counts estimates as spent)", () => {
    const a = reserve("s1", req("10000"));
    const s1 = budgetSummary(wf, db).x402;
    expect(s1.estimatedBase).toBe("10000");
    expect(s1.confirmedBase).toBe("0");
    expect(s1.reservedBase).toBe("10000");
    updatePayment(a.op.id, { status: "CONFIRMED", tx_hash: "0xabc" }, db);
    const s2 = budgetSummary(wf, db).x402;
    expect(s2.confirmedBase).toBe("10000");
    expect(s2.reservedBase).toBe("0");
  });
});
