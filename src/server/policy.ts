import { getDb, now, type DB } from "./db";
import { emit, newId, toBaseUnits } from "./core";
import { env, USDC_DECIMALS, MON_DECIMALS, explorerTx } from "./env";
import type { BudgetInput } from "./planner";

/**
 * Deterministic treasury / policy guard.
 * The LLM never authorizes spending; every paid operation goes through reservePayment().
 * USDC (x402) and MON (escrow / gas) are SEPARATE budgets — never converted into each other.
 */

export interface StoredBudget {
  input: BudgetInput;
  x402UsdcBase: string;
  perCallUsdcBase: string;
  approvalThresholdUsdcBase: string;
  escrowMonWei: string;
  gasMonWei: string;
  highValueApproved: boolean;
}

export function toStoredBudget(b: BudgetInput): StoredBudget {
  return {
    input: b,
    x402UsdcBase: toBaseUnits(String(b.x402Usdc), USDC_DECIMALS).toString(),
    perCallUsdcBase: toBaseUnits(String(b.perCallUsdc), USDC_DECIMALS).toString(),
    approvalThresholdUsdcBase: toBaseUnits(String(b.approvalThresholdUsdc), USDC_DECIMALS).toString(),
    escrowMonWei: toBaseUnits(String(b.escrowMon), MON_DECIMALS).toString(),
    gasMonWei: toBaseUnits(String(b.gasMon), MON_DECIMALS).toString(),
    highValueApproved: false,
  };
}

export interface ProviderPolicy {
  id: string;
  name: string;
  baseUrl: string;
  payTo: string;
  allowedPaths: string[];
}

/** Allowlisted x402 providers. Destinations cannot be supplied by clients or the LLM. */
export function providers(): ProviderPolicy[] {
  const e = env();
  return [
    {
      id: "synapse-data",
      name: "Synapse Monad Data Service (x402)",
      baseUrl: e.X402_SERVICE_URL,
      payTo: e.X402_PAY_TO ?? "",
      allowedPaths: ["/v1/monad/ecosystem", "/v1/monad/deep-dive"],
    },
  ];
}

export interface PaymentRequirementLike {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export type PaymentStatus =
  | "REJECTED"
  | "RESERVED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "RELEASED"
  | "FAILED"
  | "UNKNOWN";

export interface PaymentOp {
  id: string;
  idempotency_key: string;
  workflow_id: string;
  task_id: string | null;
  kind: string;
  provider: string;
  resource_url: string;
  network: string | null;
  asset: string | null;
  pay_to: string | null;
  amount_base: string;
  status: PaymentStatus;
  status_reason: string | null;
  authorization_nonce: string | null;
  payer: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  verification_json: string | null;
  created_at: number;
  updated_at: number;
}

export type ReserveResult =
  | { decision: "APPROVED"; op: PaymentOp }
  | { decision: "DUPLICATE"; op: PaymentOp }
  | { decision: "REJECTED"; op: PaymentOp; reason: string };

const COMMITTED: PaymentStatus[] = ["RESERVED", "SUBMITTED", "UNKNOWN", "CONFIRMED"];

export function getBudget(workflowId: string, db: DB = getDb()): StoredBudget {
  const row = db.prepare(`SELECT budget_json FROM workflows WHERE id = ?`).get(workflowId) as
    | { budget_json: string }
    | undefined;
  if (!row) throw new Error(`workflow ${workflowId} not found`);
  return JSON.parse(row.budget_json);
}

export function getPaymentOp(id: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM payment_operations WHERE id = ?`).get(id) as PaymentOp | undefined;
}
export function getPaymentOpByKey(key: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM payment_operations WHERE idempotency_key = ?`).get(key) as PaymentOp | undefined;
}

export function evaluateRequirement(
  req: PaymentRequirementLike,
  provider: ProviderPolicy,
  budget: StoredBudget,
  committedBase: bigint,
  taskMaxBase: bigint,
): string | null {
  const e = env();
  if (req.scheme !== "exact") return `unsupported scheme ${req.scheme}`;
  if (req.network !== e.X402_NETWORK_ID) return `network mismatch: ${req.network} != ${e.X402_NETWORK_ID}`;
  if (req.asset.toLowerCase() !== e.X402_ASSET_ADDRESS.toLowerCase()) return `asset ${req.asset} not allowlisted`;
  if (!provider.payTo || req.payTo.toLowerCase() !== provider.payTo.toLowerCase())
    return `payee ${req.payTo} is not the allowlisted address for ${provider.id}`;
  if (!/^\d+$/.test(req.amount)) return `invalid amount ${req.amount}`;
  const amt = BigInt(req.amount);
  if (amt <= 0n) return "amount must be positive";
  if (amt > BigInt(budget.perCallUsdcBase)) return `amount ${amt} exceeds per-call cap ${budget.perCallUsdcBase}`;
  if (amt > taskMaxBase) return `amount ${amt} exceeds task max cost ${taskMaxBase}`;
  if (committedBase + amt > BigInt(budget.x402UsdcBase))
    return `budget exhausted: committed ${committedBase} + ${amt} > cap ${budget.x402UsdcBase}`;
  if (amt > BigInt(budget.approvalThresholdUsdcBase) && !budget.highValueApproved)
    return `amount ${amt} exceeds approval threshold ${budget.approvalThresholdUsdcBase}; operator approval required`;
  return null;
}

export function committedSpend(workflowId: string, db: DB = getDb()): bigint {
  const rows = db
    .prepare(
      `SELECT amount_base FROM payment_operations WHERE workflow_id = ? AND status IN (${COMMITTED.map(() => "?").join(",")})`,
    )
    .all(workflowId, ...COMMITTED) as { amount_base: string }[];
  return rows.reduce((s, r) => s + BigInt(r.amount_base), 0n);
}

/**
 * Atomically check policy and reserve funds for one paid request.
 * Same idempotency key => returns the existing operation (never a second charge).
 */
export function reservePayment(
  args: {
    workflowId: string;
    taskId: string;
    idempotencyKey: string;
    providerId: string;
    resourceUrl: string;
    requirement: PaymentRequirementLike;
    taskMaxUsdcBase: bigint;
  },
  db: DB = getDb(),
): ReserveResult {
  return db.transaction((): ReserveResult => {
    const existing = getPaymentOpByKey(args.idempotencyKey, db);
    if (existing && !["FAILED", "RELEASED", "REJECTED"].includes(existing.status)) {
      return { decision: "DUPLICATE", op: existing };
    }
    const provider = providers().find((p) => p.id === args.providerId);
    const budget = getBudget(args.workflowId, db);
    let reason: string | null = null;
    if (!provider) reason = `provider ${args.providerId} not allowlisted`;
    else {
      const u = new URL(args.resourceUrl);
      if (u.origin !== new URL(provider.baseUrl).origin || !provider.allowedPaths.includes(u.pathname))
        reason = `resource ${args.resourceUrl} not allowlisted for ${provider.id}`;
      else reason = evaluateRequirement(args.requirement, provider, budget, committedSpend(args.workflowId, db), args.taskMaxUsdcBase);
    }
    const status: PaymentStatus = reason ? "REJECTED" : "RESERVED";
    const t = now();
    const id = existing?.id ?? newId("pay");
    db.prepare(
      `INSERT INTO payment_operations (id, idempotency_key, workflow_id, task_id, kind, provider, resource_url, network, asset, pay_to, amount_base, status, status_reason, created_at, updated_at)
       VALUES (@id,@key,@wf,@task,'X402',@provider,@url,@network,@asset,@payTo,@amount,@status,@reason,@t,@t)
       ON CONFLICT(idempotency_key) DO UPDATE SET status=excluded.status, status_reason=excluded.status_reason,
         amount_base=excluded.amount_base, pay_to=excluded.pay_to, authorization_nonce=NULL, tx_hash=NULL, explorer_url=NULL, updated_at=excluded.updated_at`,
    ).run({
      id,
      key: args.idempotencyKey,
      wf: args.workflowId,
      task: args.taskId,
      provider: args.providerId,
      url: args.resourceUrl,
      network: args.requirement.network,
      asset: args.requirement.asset,
      payTo: args.requirement.payTo,
      amount: args.requirement.amount,
      status,
      reason,
      t,
    });
    const op = getPaymentOp(id, db)!;
    emit(
      args.workflowId,
      reason ? "payment.rejected" : "payment.reserved",
      reason ? `Policy rejected x402 purchase: ${reason}` : `Policy approved and reserved ${fmtUsdc(op.amount_base)} USDC`,
      { taskId: args.taskId, level: reason ? "warn" : "info", data: { paymentId: id, amount: op.amount_base }, db },
    );
    return reason ? { decision: "REJECTED", op, reason } : { decision: "APPROVED", op };
  })();
}

export function updatePayment(id: string, patch: Partial<PaymentOp>, db: DB = getDb()) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  db.prepare(
    `UPDATE payment_operations SET ${cols.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @__t WHERE id = @__id`,
  ).run({ ...patch, __t: now(), __id: id });
}

export function confirmPayment(id: string, txHash: string, verification: unknown, db: DB = getDb()) {
  updatePayment(
    id,
    { status: "CONFIRMED", tx_hash: txHash, explorer_url: explorerTx(txHash), verification_json: JSON.stringify(verification), status_reason: null },
    db,
  );
}

export const fmtUsdc = (base: string | bigint) => {
  const b = BigInt(base);
  const i = b / 1_000_000n;
  const f = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
};

export function budgetSummary(workflowId: string, db: DB = getDb()) {
  const budget = getBudget(workflowId, db);
  const rows = db
    .prepare(`SELECT status, amount_base FROM payment_operations WHERE workflow_id = ?`)
    .all(workflowId) as { status: PaymentStatus; amount_base: string }[];
  const sum = (s: PaymentStatus[]) =>
    rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + BigInt(r.amount_base), 0n).toString();
  const wf = db.prepare(`SELECT plan_json FROM workflows WHERE id = ?`).get(workflowId) as { plan_json: string };
  const plan = JSON.parse(wf.plan_json) as { totalEstimatedUsdc: number };
  return {
    x402: {
      unit: "USDC",
      capBase: budget.x402UsdcBase,
      estimatedBase: toBaseUnits(String(plan.totalEstimatedUsdc), USDC_DECIMALS).toString(),
      reservedBase: sum(["RESERVED", "SUBMITTED"]),
      confirmedBase: sum(["CONFIRMED"]),
      releasedBase: sum(["RELEASED"]),
      failedBase: sum(["FAILED"]),
      unknownBase: sum(["UNKNOWN"]),
      rejectedBase: sum(["REJECTED"]),
    },
    escrow: { unit: "MON", capWei: budget.escrowMonWei },
    gas: { unit: "MON", capWei: budget.gasMonWei },
  };
}
