import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { authorizationUsed, balances, findAuthorizationTx, verifyUsdcTransfer } from "./chain";
import { emit, getArtifact, storeArtifact } from "./core";
import { getDb, type DB } from "./db";
import { env, explorerTx } from "./env";
import {
  confirmPayment,
  fmtUsdc,
  getPaymentOp,
  getPaymentOpByKey,
  providers,
  reservePayment,
  updatePayment,
  type PaymentOp,
} from "./policy";

export type PurchaseOutcome =
  | { status: "PAID"; op: PaymentOp; artifactId: string; data: unknown }
  | { status: "REUSED"; op: PaymentOp; artifactId: string; data: unknown }
  | { status: "REJECTED"; op: PaymentOp; reason: string }
  | { status: "BLOCKED"; reason: string }
  | { status: "FAILED"; op?: PaymentOp; reason: string }
  | { status: "UNKNOWN"; op: PaymentOp; reason: string }
  | { status: "PAID_NOT_DELIVERED"; op: PaymentOp; reason: string };

interface StoredAuth {
  authorization?: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
  artifactId?: string;
  onchain?: unknown;
  deliveryFailed?: string;
}

function payerKey(): Hex | null {
  return (env().OPERATOR_PRIVATE_KEY as Hex | undefined) ?? null;
}

function httpClient() {
  const pk = payerKey();
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(pk);
  const client = new x402Client().register(env().X402_NETWORK_ID as `${string}:${string}`, new ExactEvmScheme(account));
  return { http: new x402HTTPClient(client), payer: account.address };
}

const parseStored = (op: PaymentOp): StoredAuth => (op.verification_json ? JSON.parse(op.verification_json) : {});

/**
 * Reconcile an operation whose outcome is unknown, using the chain as source of truth.
 * Never re-signs a payment while a previous authorization could still settle.
 */
export async function reconcilePayment(opId: string, db: DB = getDb()): Promise<PaymentOp> {
  const op = getPaymentOp(opId, db)!;
  if (!["SUBMITTED", "UNKNOWN"].includes(op.status)) return op;
  const stored = parseStored(op);
  const auth = stored.authorization;
  if (!auth || !op.asset) {
    // Never signed => nothing could have been charged.
    updatePayment(opId, { status: "RELEASED", status_reason: "no authorization was ever signed" }, db);
    return getPaymentOp(opId, db)!;
  }
  const used = await authorizationUsed(op.asset as Address, auth.from as Address, auth.nonce as Hex);
  if (used) {
    const tx = op.tx_hash ?? (await findAuthorizationTx(op.asset as Address, auth.from as Address, auth.nonce as Hex));
    let verification: unknown = { authorizationUsed: true };
    if (tx) {
      verification = await verifyUsdcTransfer({
        txHash: tx as Hex,
        asset: op.asset as Address,
        from: auth.from as Address,
        to: auth.to as Address,
        amount: BigInt(auth.value),
        nonce: auth.nonce as Hex,
      });
    }
    confirmPayment(opId, tx ?? "unknown", { ...stored, onchain: verification, reconciled: true }, db);
    if (!tx) updatePayment(opId, { explorer_url: null }, db);
    emit(op.workflow_id, "payment.reconciled", `Reconciled: authorization nonce consumed on-chain; payment CONFIRMED (no re-payment)`, {
      taskId: op.task_id ?? undefined,
      level: "success",
      data: { paymentId: opId, txHash: tx },
      db,
    });
  } else if (Number(auth.validBefore) * 1000 < Date.now()) {
    updatePayment(opId, { status: "RELEASED", status_reason: "authorization expired unused on-chain; reservation released" }, db);
    emit(op.workflow_id, "payment.released", `Authorization expired unused; ${fmtUsdc(op.amount_base)} USDC reservation released`, {
      taskId: op.task_id ?? undefined,
      db,
    });
  } else {
    updatePayment(opId, { status: "UNKNOWN", status_reason: "authorization not yet used and still valid; awaiting expiry or settlement" }, db);
  }
  return getPaymentOp(opId, db)!;
}

/**
 * Policy-gated x402 purchase:
 *  request -> 402 -> parse requirements -> policy reserve -> sign EIP-3009 authorization
 *  -> retry with PAYMENT-SIGNATURE -> facilitator settles -> verify Transfer log on Monad.
 */
export async function purchase(
  args: {
    workflowId: string;
    taskId: string;
    workerId: string;
    providerId: string;
    path: string;
    idempotencyKey: string;
    taskMaxUsdcBase: bigint;
  },
  db: DB = getDb(),
): Promise<PurchaseOutcome> {
  const provider = providers().find((p) => p.id === args.providerId);
  if (!provider) return { status: "BLOCKED", reason: `provider ${args.providerId} not allowlisted` };
  const url = new URL(args.path, provider.baseUrl).toString();
  const ctx = { taskId: args.taskId, workerId: args.workerId, db };

  // 1. Idempotency: an existing operation for this key is reused or reconciled, never re-paid.
  let existing = getPaymentOpByKey(args.idempotencyKey, db);
  if (existing && ["SUBMITTED", "UNKNOWN"].includes(existing.status)) {
    emit(args.workflowId, "payment.reconciling", "Payment outcome unknown from a previous attempt; reconciling on-chain before any retry", ctx);
    existing = await reconcilePayment(existing.id, db);
  }
  if (existing?.status === "CONFIRMED") {
    const s = parseStored(existing);
    const art = s.artifactId ? getArtifact(s.artifactId, db) : undefined;
    if (art) {
      emit(args.workflowId, "payment.reused", `Reusing paid dataset from settled payment ${existing.id} (no second charge)`, { ...ctx, level: "success" });
      return { status: "REUSED", op: existing, artifactId: art.id, data: JSON.parse(art.content) };
    }
    return { status: "PAID_NOT_DELIVERED", op: existing, reason: "payment settled but no delivered artifact recorded; dispute with provider (no automatic chargeback)" };
  }
  if (existing && ["SUBMITTED", "UNKNOWN"].includes(existing.status)) {
    return { status: "UNKNOWN", op: existing, reason: existing.status_reason ?? "unknown payment outcome" };
  }

  if (!payerKey()) return { status: "BLOCKED", reason: "OPERATOR_PRIVATE_KEY (x402 payer) not configured" };
  const { http, payer } = httpClient();

  // 2. Unpaid request.
  let first: Response;
  try {
    first = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return { status: "BLOCKED", reason: `paid service unreachable at ${provider.baseUrl}: ${(err as Error).message}` };
  }
  if (first.status >= 500) {
    // Provider-side transient error (e.g. facilitator not yet reachable). Nothing was signed; retry the probe once.
    emit(args.workflowId, "payment.provider_error", `Paid service returned HTTP ${first.status}; retrying unpaid probe once`, { ...ctx, level: "warn" });
    await new Promise((r) => setTimeout(r, 3000));
    try {
      first = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      return { status: "BLOCKED", reason: `paid service unreachable at ${provider.baseUrl}: ${(err as Error).message}` };
    }
  }
  if (first.status !== 402) {
    return { status: "FAILED", reason: `expected HTTP 402 from ${url}, got ${first.status}` };
  }
  let required: PaymentRequired;
  try {
    const body = await first.json().catch(() => undefined);
    required = http.getPaymentRequiredResponse((h) => first.headers.get(h), body);
  } catch (err) {
    return { status: "FAILED", reason: `invalid PAYMENT-REQUIRED: ${(err as Error).message}` };
  }
  emit(args.workflowId, "payment.required", `HTTP 402 from ${provider.name}: ${required.accepts.length} payment option(s)`, {
    ...ctx,
    data: { accepts: required.accepts, x402Version: required.x402Version },
  });

  // 3. Choose only an option on our configured network; policy decides.
  const option: PaymentRequirements | undefined =
    required.accepts.find((a) => a.network === env().X402_NETWORK_ID && a.scheme === "exact") ?? required.accepts[0];
  const reservation = reservePayment(
    {
      workflowId: args.workflowId,
      taskId: args.taskId,
      idempotencyKey: args.idempotencyKey,
      providerId: provider.id,
      resourceUrl: url,
      requirement: option,
      taskMaxUsdcBase: args.taskMaxUsdcBase,
    },
    db,
  );
  if (reservation.decision === "REJECTED") return { status: "REJECTED", op: reservation.op, reason: reservation.reason };
  if (reservation.decision === "DUPLICATE") return purchase(args, db); // resolved by idempotency branch
  const op = reservation.op;

  // 4a. Funding preflight: never sign an authorization the payer cannot cover.
  try {
    const bal = await balances(payer);
    if (bal.usdcBase === null || BigInt(bal.usdcBase) < BigInt(op.amount_base)) {
      const reason = `payer ${payer} has ${bal.usdcBase ?? "?"} base units of testnet USDC; needs ${op.amount_base}. Fund via https://faucet.circle.com (Monad Testnet)`;
      updatePayment(op.id, { status: "RELEASED", status_reason: `blocked: ${reason}` }, db);
      emit(args.workflowId, "payment.blocked", `x402 payment blocked before signing: ${reason}`, { ...ctx, level: "warn" });
      return { status: "BLOCKED", reason };
    }
  } catch (err) {
    updatePayment(op.id, { status: "RELEASED", status_reason: `balance check failed: ${(err as Error).message.slice(0, 120)}` }, db);
    return { status: "BLOCKED", reason: `could not read payer USDC balance: ${(err as Error).message.slice(0, 120)}` };
  }

  // 4b. Sign the EIP-3009 authorization and persist it BEFORE sending (crash-safe reconciliation).
  let header: Record<string, string>;
  try {
    const payload = await http.createPaymentPayload({ ...required, accepts: [option] });
    const auth = (payload.payload as { authorization?: StoredAuth["authorization"] }).authorization;
    updatePayment(
      op.id,
      { status: "SUBMITTED", payer, authorization_nonce: auth?.nonce ?? null, verification_json: JSON.stringify({ authorization: auth }) },
      db,
    );
    header = http.encodePaymentSignatureHeader(payload);
  } catch (err) {
    updatePayment(op.id, { status: "RELEASED", status_reason: `signing failed: ${(err as Error).message.slice(0, 200)}` }, db);
    return { status: "FAILED", op: getPaymentOp(op.id, db), reason: `could not create payment payload: ${(err as Error).message}` };
  }
  emit(args.workflowId, "payment.submitted", `Signed EIP-3009 authorization for ${fmtUsdc(op.amount_base)} USDC; sending to provider`, {
    ...ctx,
    data: { paymentId: op.id },
  });

  // 5. Paid request; facilitator verifies + settles.
  let paid: Response;
  try {
    paid = await fetch(url, { headers: header, signal: AbortSignal.timeout(90_000) });
  } catch (err) {
    updatePayment(op.id, { status: "UNKNOWN", status_reason: `paid request transport error: ${(err as Error).message}` }, db);
    const r = await reconcilePayment(op.id, db);
    return { status: "UNKNOWN", op: r, reason: "transport error after signing; reconciled state recorded" };
  }
  if (!paid.ok) {
    let reason = `provider returned HTTP ${paid.status}`;
    try {
      const pr = http.getPaymentRequiredResponse((h) => paid.headers.get(h), await paid.json().catch(() => undefined));
      if (pr.error) reason += `: ${pr.error}`;
    } catch {
      /* not a 402 body */
    }
    updatePayment(op.id, { status: "UNKNOWN", status_reason: reason }, db);
    const r = await reconcilePayment(op.id, db);
    emit(args.workflowId, "payment.failed", `x402 paid request failed: ${reason}`, { ...ctx, level: "error", data: { paymentId: op.id, status: r.status } });
    return { status: r.status === "CONFIRMED" ? "PAID_NOT_DELIVERED" : "FAILED", op: r, reason } as PurchaseOutcome;
  }

  const data = await paid.json();
  let settle: { success: boolean; transaction: string; network: string; payer?: string } | null = null;
  try {
    settle = http.getPaymentSettleResponse((h) => paid.headers.get(h));
  } catch {
    settle = null;
  }
  const stored = parseStored(getPaymentOp(op.id, db)!);
  const art = storeArtifact({ workflowId: args.workflowId, taskId: args.taskId, kind: "x402-dataset", mime: "application/json", content: JSON.stringify(data), producedBy: provider.id }, db);
  stored.artifactId = art.id;

  if (!settle?.transaction) {
    updatePayment(op.id, { status: "UNKNOWN", status_reason: "no PAYMENT-RESPONSE settlement header", verification_json: JSON.stringify(stored) }, db);
    const r = await reconcilePayment(op.id, db);
    return r.status === "CONFIRMED"
      ? { status: "PAID", op: r, artifactId: art.id, data }
      : { status: "UNKNOWN", op: r, reason: "delivered without settlement proof; awaiting reconciliation" };
  }

  // 6. Verify against chain data, not the provider's word.
  const verification = await verifyUsdcTransfer({
    txHash: settle.transaction as Hex,
    asset: op.asset as Address,
    from: payer,
    to: op.pay_to as Address,
    amount: BigInt(op.amount_base),
    nonce: stored.authorization?.nonce as Hex | undefined,
  }).catch((err) => ({ verified: false, reason: (err as Error).message, checkedAt: Date.now() }));
  stored.onchain = verification;
  if (verification.verified) {
    confirmPayment(op.id, settle.transaction, stored, db);
    emit(args.workflowId, "payment.confirmed", `x402 payment settled on Monad testnet and verified (USDC Transfer log matched)`, {
      ...ctx,
      level: "success",
      data: { paymentId: op.id, txHash: settle.transaction, explorer: explorerTx(settle.transaction) },
    });
    return { status: "PAID", op: getPaymentOp(op.id, db)!, artifactId: art.id, data };
  }
  updatePayment(op.id, { status: "UNKNOWN", tx_hash: settle.transaction, explorer_url: explorerTx(settle.transaction), status_reason: `on-chain verification failed: ${verification.reason}`, verification_json: JSON.stringify(stored) }, db);
  return { status: "UNKNOWN", op: getPaymentOp(op.id, db)!, reason: `settlement claimed but not verified: ${verification.reason}` };
}
