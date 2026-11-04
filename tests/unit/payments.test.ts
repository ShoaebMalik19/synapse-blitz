import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock only the chain-reading layer; the policy/idempotency logic under test is real.
const chain = vi.hoisted(() => ({
  authorizationUsed: vi.fn(),
  findAuthorizationTx: vi.fn(),
  verifyUsdcTransfer: vi.fn(),
  balances: vi.fn(),
}));
vi.mock("../../src/server/chain", async (orig) => ({ ...(await orig<object>()), ...chain }));

import { storeArtifact } from "../../src/server/core";
import { getPaymentOp, reservePayment, updatePayment } from "../../src/server/policy";
import { purchase, reconcilePayment } from "../../src/server/x402pay";
import { activeWorkflow, freshDb } from "./helpers";
import type { DB } from "../../src/server/db";

const PAY_TO = "0x6cCC8A2fB675ecf7b4324e334773b95843818787";
const ASSET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PAYER = "0x33D32B469efDcC765f1CfE84737A337e814faCf2";
const NONCE = "0x" + "11".repeat(32);

let db: DB;
let wf: string;

function submittedOp(key: string, validBeforeSec: number) {
  const r = reservePayment(
    {
      workflowId: wf,
      taskId: "research",
      idempotencyKey: key,
      providerId: "synapse-data",
      resourceUrl: "http://localhost:4021/v1/monad/ecosystem",
      requirement: { scheme: "exact", network: "eip155:10143", asset: ASSET, amount: "10000", payTo: PAY_TO },
      taskMaxUsdcBase: 20000n,
    },
    db,
  );
  updatePayment(
    r.op.id,
    {
      status: "UNKNOWN",
      payer: PAYER,
      authorization_nonce: NONCE,
      verification_json: JSON.stringify({ authorization: { from: PAYER, to: PAY_TO, value: "10000", validAfter: "0", validBefore: String(validBeforeSec), nonce: NONCE } }),
    },
    db,
  );
  return r.op.id;
}

beforeEach(async () => {
  db = freshDb();
  wf = await activeWorkflow(db);
  Object.values(chain).forEach((f) => f.mockReset());
});

describe("x402 payment reconciliation & replay safety", () => {
  it("unknown outcome + nonce consumed on-chain => CONFIRMED with tx, never re-paid", async () => {
    const id = submittedOp("k", Math.floor(Date.now() / 1000) + 600);
    chain.authorizationUsed.mockResolvedValue(true);
    chain.findAuthorizationTx.mockResolvedValue("0x" + "ab".repeat(32));
    chain.verifyUsdcTransfer.mockResolvedValue({ verified: true, blockNumber: "1", checkedAt: 0 });
    const op = await reconcilePayment(id, db);
    expect(op.status).toBe("CONFIRMED");
    expect(op.tx_hash).toBe("0x" + "ab".repeat(32));
  });

  it("unknown outcome + nonce unused + authorization expired => RELEASED (safe to retry)", async () => {
    const id = submittedOp("k", Math.floor(Date.now() / 1000) - 10);
    chain.authorizationUsed.mockResolvedValue(false);
    expect((await reconcilePayment(id, db)).status).toBe("RELEASED");
  });

  it("unknown outcome + nonce unused + still valid => stays UNKNOWN (no blind resubmission)", async () => {
    const id = submittedOp("k", Math.floor(Date.now() / 1000) + 600);
    chain.authorizationUsed.mockResolvedValue(false);
    expect((await reconcilePayment(id, db)).status).toBe("UNKNOWN");
  });

  it("purchase() reuses a settled payment's artifact instead of paying again (recovery path)", async () => {
    const id = submittedOp("wf:dataset", Math.floor(Date.now() / 1000) + 600);
    const art = storeArtifact({ workflowId: wf, taskId: "research", kind: "x402-dataset", mime: "application/json", content: JSON.stringify({ hello: "monad" }) }, db);
    const stored = JSON.parse(getPaymentOp(id, db)!.verification_json!);
    updatePayment(id, { status: "CONFIRMED", tx_hash: "0x" + "cd".repeat(32), verification_json: JSON.stringify({ ...stored, artifactId: art.id }) }, db);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await purchase(
      { workflowId: wf, taskId: "research", workerId: "worker-b", providerId: "synapse-data", path: "/v1/monad/ecosystem", idempotencyKey: "wf:dataset", taskMaxUsdcBase: 20000n },
      db,
    );
    expect(r.status).toBe("REUSED");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((db.prepare(`SELECT COUNT(*) c FROM payment_operations`).get() as { c: number }).c).toBe(1);
    fetchSpy.mockRestore();
  });

  it("purchase() reconciles an UNKNOWN op first and does not sign a new authorization while it may still settle", async () => {
    submittedOp("wf:dataset", Math.floor(Date.now() / 1000) + 600);
    chain.authorizationUsed.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await purchase(
      { workflowId: wf, taskId: "research", workerId: "worker-b", providerId: "synapse-data", path: "/v1/monad/ecosystem", idempotencyKey: "wf:dataset", taskMaxUsdcBase: 20000n },
      db,
    );
    expect(r.status).toBe("UNKNOWN");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("blocks signing when the payer cannot cover the payment (no authorization created)", async () => {
    process.env.OPERATOR_PRIVATE_KEY = "0x" + "01".repeat(32);
    const { setEnvForTests } = await import("../../src/server/env");
    setEnvForTests({ OPERATOR_PRIVATE_KEY: "0x" + "01".repeat(32) });
    chain.balances.mockResolvedValue({ monWei: "0", usdcBase: "0" });
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        resource: { url: "http://localhost:4021/v1/monad/ecosystem" },
        accepts: [{ scheme: "exact", network: "eip155:10143", amount: "10000", asset: ASSET, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { name: "USDC", version: "2" } }],
      }),
    ).toString("base64");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { "PAYMENT-REQUIRED": header } }));
    const r = await purchase(
      { workflowId: wf, taskId: "research", workerId: "worker-a", providerId: "synapse-data", path: "/v1/monad/ecosystem", idempotencyKey: "k-unfunded", taskMaxUsdcBase: 20000n },
      db,
    );
    expect(r.status).toBe("BLOCKED");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the unpaid probe; no paid retry
    const op = db.prepare(`SELECT status, authorization_nonce FROM payment_operations WHERE idempotency_key='k-unfunded'`).get() as { status: string; authorization_nonce: string | null };
    expect(op).toEqual({ status: "RELEASED", authorization_nonce: null });
    fetchSpy.mockRestore();
    setEnvForTests({ OPERATOR_PRIVATE_KEY: "" });
  });
});
