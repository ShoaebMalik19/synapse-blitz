import { keccak256, parseEventLogs, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import TaskEscrowArtifact from "../lib/contracts/TaskEscrow.json";
import { assertExpectedChain, publicClient, walletFor } from "./chain";
import { emit, newId } from "./core";
import { getDb, now, type DB } from "./db";
import { env, explorerTx } from "./env";
import { getBudget } from "./policy";

export const TaskEscrowAbi = TaskEscrowArtifact.abi as unknown as import("viem").Abi;

export const ESCROW_STATES = ["None", "Created", "Funded", "Submitted", "Settled", "Refunded", "Cancelled"] as const;

export type EscrowAction = "GAS_TOPUP" | "CREATE" | "FUND" | "SUBMIT" | "ACCEPT" | "REFUND";

export interface EscrowOp {
  id: string;
  workflow_id: string;
  onchain_task_id: string;
  action: EscrowAction;
  status: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "BLOCKED";
  status_reason: string | null;
  from_address: string | null;
  amount_wei: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  block_number: number | null;
  verification_json: string | null;
}

export function onchainTaskId(workflowId: string): Hex {
  return keccak256(toBytes(`synapse:${workflowId}`));
}

export function escrowAddress(): Address | null {
  return (env().MONAD_ESCROW_ADDRESS as Address | undefined) ?? null;
}

export function escrowOps(workflowId: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM escrow_operations WHERE workflow_id = ? ORDER BY created_at`).all(workflowId) as EscrowOp[];
}

function getOp(workflowId: string, action: EscrowAction, db: DB) {
  return db.prepare(`SELECT * FROM escrow_operations WHERE workflow_id = ? AND action = ?`).get(workflowId, action) as
    | EscrowOp
    | undefined;
}

function upsertOp(workflowId: string, action: EscrowAction, patch: Partial<EscrowOp>, db: DB) {
  const existing = getOp(workflowId, action, db);
  const t = now();
  if (!existing) {
    db.prepare(
      `INSERT INTO escrow_operations (id, workflow_id, onchain_task_id, action, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(newId("esc"), workflowId, onchainTaskId(workflowId), action, patch.status ?? "PENDING", t, t);
  }
  const cols = Object.keys(patch);
  if (cols.length)
    db.prepare(
      `UPDATE escrow_operations SET ${cols.map((c) => `${c}=@${c}`).join(",")}, updated_at=@__t WHERE workflow_id=@__wf AND action=@__a`,
    ).run({ ...patch, __t: t, __wf: workflowId, __a: action });
  return getOp(workflowId, action, db)!;
}

export function blockEscrow(workflowId: string, action: EscrowAction, reason: string, db: DB = getDb()) {
  const op = upsertOp(workflowId, action, { status: "BLOCKED", status_reason: reason }, db);
  emit(workflowId, "escrow.blocked", `Escrow ${action} blocked: ${reason}`, { level: "warn", db });
  return op;
}

/**
 * Exactly-once on-chain action. If a tx was already broadcast for this (workflow, action) we
 * reconcile its receipt instead of re-sending — a broadcast tx is never blindly replayed.
 */
async function runOnce(
  workflowId: string,
  action: EscrowAction,
  pk: Hex,
  send: (w: ReturnType<typeof walletFor>) => Promise<Hex>,
  meta: { amountWei?: bigint; label: string },
  db: DB = getDb(),
): Promise<EscrowOp> {
  const existing = getOp(workflowId, action, db);
  if (existing?.status === "CONFIRMED") return existing;
  const pc = publicClient();
  if (existing?.status === "SUBMITTED" && existing.tx_hash) {
    const r = await pc.waitForTransactionReceipt({ hash: existing.tx_hash as Hex, timeout: 60_000 });
    return finalize(workflowId, action, r.status === "success", r.blockNumber, existing.tx_hash as Hex, meta.label, db);
  }
  await assertExpectedChain();
  const w = walletFor(pk);
  upsertOp(
    workflowId,
    action,
    { status: "PENDING", from_address: w.account.address, amount_wei: meta.amountWei?.toString() ?? null, status_reason: null },
    db,
  );
  let hash: Hex;
  try {
    hash = await send(w);
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0].slice(0, 300);
    upsertOp(workflowId, action, { status: "FAILED", status_reason: msg }, db);
    emit(workflowId, "escrow.failed", `${meta.label} failed before broadcast: ${msg}`, { level: "error", db });
    throw err;
  }
  upsertOp(workflowId, action, { status: "SUBMITTED", tx_hash: hash, explorer_url: explorerTx(hash) }, db);
  emit(workflowId, "escrow.submitted", `${meta.label} broadcast`, { data: { txHash: hash, explorer: explorerTx(hash) }, db });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return finalize(workflowId, action, r.status === "success", r.blockNumber, hash, meta.label, db);
}

function finalize(workflowId: string, action: EscrowAction, ok: boolean, block: bigint, hash: Hex, label: string, db: DB) {
  const op = upsertOp(
    workflowId,
    action,
    { status: ok ? "CONFIRMED" : "FAILED", block_number: Number(block), status_reason: ok ? null : "transaction reverted" },
    db,
  );
  emit(workflowId, ok ? "escrow.confirmed" : "escrow.failed", `${label} ${ok ? "confirmed" : "reverted"} in block ${block}`, {
    level: ok ? "success" : "error",
    data: { txHash: hash, explorer: explorerTx(hash), block: block.toString() },
    db,
  });
  return op;
}

export async function readEscrowTask(workflowId: string) {
  const addr = escrowAddress();
  if (!addr) return null;
  const t = (await publicClient().readContract({
    address: addr,
    abi: TaskEscrowAbi,
    functionName: "getTask",
    args: [onchainTaskId(workflowId)],
  })) as {
    requester: Address;
    payee: Address;
    verifier: Address;
    amount: bigint;
    deadline: bigint;
    state: number;
    specHash: Hex;
    resultHash: Hex;
  };
  return { ...t, amount: t.amount.toString(), deadline: t.deadline.toString(), stateName: ESCROW_STATES[t.state] };
}

function keys() {
  const e = env();
  return { operator: e.OPERATOR_PRIVATE_KEY as Hex | undefined, workerB: e.WORKER_B_PRIVATE_KEY as Hex | undefined };
}

/** Preflight: returns a human-readable blocker or null. */
export async function escrowBlocker(workflowId: string, db: DB = getDb()): Promise<string | null> {
  const addr = escrowAddress();
  const k = keys();
  if (!addr) return "MONAD_ESCROW_ADDRESS not configured (run npm run deploy:escrow after funding the operator wallet)";
  if (!k.operator) return "OPERATOR_PRIVATE_KEY not configured";
  if (!k.workerB) return "WORKER_B_PRIVATE_KEY not configured";
  try {
    await assertExpectedChain();
    const code = await publicClient().getCode({ address: addr });
    if (!code || code === "0x") return `no contract code at ${addr} on chain ${env().MONAD_CHAIN_ID}`;
    const bal = await publicClient().getBalance({ address: privateKeyToAccount(k.operator).address });
    const budget = getBudget(workflowId, db);
    const need = BigInt(budget.escrowMonWei) + 0n;
    if (bal < need + 10n ** 16n)
      return `operator wallet has ${bal} wei MON; needs escrow ${need} wei + gas. Fund it from https://faucet.monad.xyz`;
  } catch (err) {
    return `chain preflight failed: ${(err as Error).message.slice(0, 200)}`;
  }
  return null;
}

/** Commit the deliverable on-chain and lock escrow. Called once when the plan is approved. */
export async function createAndFundEscrow(workflowId: string, specHash: Hex, db: DB = getDb()) {
  const blocker = await escrowBlocker(workflowId, db);
  if (blocker) {
    blockEscrow(workflowId, "CREATE", blocker, db);
    return { ok: false as const, reason: blocker };
  }
  const addr = escrowAddress()!;
  const { operator, workerB } = keys();
  const payee = privateKeyToAccount(workerB!).address;
  const amount = BigInt(getBudget(workflowId, db).escrowMonWei);
  const id = onchainTaskId(workflowId);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 2 * 3600);
  await runOnce(
    workflowId,
    "CREATE",
    operator!,
    (w) =>
      w.writeContract({
        address: addr,
        abi: TaskEscrowAbi,
        functionName: "createTask",
        args: [id, payee, w.account.address, deadline, specHash],
      }),
    { label: "TaskEscrow.createTask" },
    db,
  );
  await runOnce(
    workflowId,
    "FUND",
    operator!,
    (w) => w.writeContract({ address: addr, abi: TaskEscrowAbi, functionName: "fundTask", args: [id], value: amount }),
    { amountWei: amount, label: "TaskEscrow.fundTask" },
    db,
  );
  return { ok: true as const };
}

/**
 * Settle: the payee worker commits the verified result hash, then the requester/verifier accepts
 * the exact same hash. Only called after deterministic verification passed.
 */
export async function submitAndSettle(workflowId: string, resultHash: Hex, db: DB = getDb()) {
  const addr = escrowAddress();
  const { operator, workerB } = keys();
  const funded = getOp(workflowId, "FUND", db);
  if (!addr || !operator || !workerB || funded?.status !== "CONFIRMED") {
    const reason = funded?.status === "BLOCKED" || !funded ? "escrow was never funded for this workflow" : "escrow prerequisites missing";
    blockEscrow(workflowId, "ACCEPT", reason, db);
    return { ok: false as const, reason };
  }
  const pc = publicClient();
  const payee = privateKeyToAccount(workerB).address;
  // Payee needs gas for submitResult; top up from the operator within the gas allowance.
  const payeeBal = await pc.getBalance({ address: payee });
  const minGas = 5n * 10n ** 15n; // 0.005 MON
  if (payeeBal < minGas && getOp(workflowId, "GAS_TOPUP", db)?.status !== "CONFIRMED") {
    const topup = 10n ** 16n; // 0.01 MON
    const gasCap = BigInt(getBudget(workflowId, db).gasMonWei);
    if (topup > gasCap) {
      blockEscrow(workflowId, "SUBMIT", `payee gas top-up ${topup} wei exceeds gas allowance ${gasCap} wei`, db);
      return { ok: false as const, reason: "gas allowance too small" };
    }
    await runOnce(workflowId, "GAS_TOPUP", operator, (w) => w.sendTransaction({ to: payee, value: topup }), {
      amountWei: topup,
      label: "Gas top-up operator → Worker B",
    }, db);
  }
  const id = onchainTaskId(workflowId);
  await runOnce(
    workflowId,
    "SUBMIT",
    workerB,
    (w) => w.writeContract({ address: addr, abi: TaskEscrowAbi, functionName: "submitResult", args: [id, resultHash] }),
    { label: "TaskEscrow.submitResult (Worker B)" },
    db,
  );
  const before = await pc.getBalance({ address: payee });
  const accept = await runOnce(
    workflowId,
    "ACCEPT",
    operator,
    (w) => w.writeContract({ address: addr, abi: TaskEscrowAbi, functionName: "acceptResult", args: [id, resultHash] }),
    { label: "TaskEscrow.acceptResult (settlement)" },
    db,
  );
  // Verify settlement from chain state + event logs + balance delta.
  const receipt = await pc.getTransactionReceipt({ hash: accept.tx_hash as Hex });
  const settled = parseEventLogs({ abi: TaskEscrowAbi, logs: receipt.logs, eventName: "TaskSettled" }) as unknown as {
    args: { taskId: Hex; payee: Address; amount: bigint; resultHash: Hex };
  }[];
  const onchain = await readEscrowTask(workflowId);
  const after = await pc.getBalance({ address: payee, blockNumber: receipt.blockNumber });
  const ev = settled.find((l) => l.args.taskId === id);
  const verification = {
    receiptStatus: receipt.status,
    eventFound: Boolean(ev),
    eventAmountWei: ev?.args.amount.toString(),
    eventResultHash: ev?.args.resultHash,
    resultHashMatches: ev?.args.resultHash?.toLowerCase() === resultHash.toLowerCase(),
    onchainState: onchain?.stateName,
    payee,
    payeeBalanceBeforeWei: before.toString(),
    payeeBalanceAtSettleBlockWei: after.toString(),
  };
  const ok = receipt.status === "success" && Boolean(ev) && verification.resultHashMatches && onchain?.stateName === "Settled";
  upsertOp(workflowId, "ACCEPT", { verification_json: JSON.stringify(verification) }, db);
  emit(workflowId, ok ? "escrow.settled" : "escrow.verify_failed", ok ? "Escrow settled on Monad and verified (event + state)" : "Settlement verification failed", {
    level: ok ? "success" : "error",
    data: verification,
    db,
  });
  return { ok, verification };
}
