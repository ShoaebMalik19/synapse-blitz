import type { Hex } from "viem";
import { emit } from "./core";
import { getDb, now, type DB } from "./db";
import { createAndFundEscrow, escrowOps, submitAndSettle } from "./escrow";
import { env } from "./env";
import { failAttempt } from "./runtime";
import { ACTIVE_TASK_STATES, getTasks, type TaskRow } from "./tasks";
import { getWorkflow, setWorkflowStatus, type WorkflowRow } from "./workflows";
import { reconcilePayment } from "./x402pay";

/**
 * Deterministic scheduler. Single orchestrator process; workers are separate processes that
 * claim work from the shared durable store. Workflow status is always derived from task rows.
 */

const inflight = new Set<string>();

export function setSettlement(id: string, status: string, note: string | null, db: DB = getDb()) {
  db.prepare(`UPDATE workflows SET settlement_status=?, settlement_note=?, updated_at=? WHERE id=?`).run(status, note, now(), id);
}

/** CREATED -> READY once every dependency is COMPLETED. */
export function promoteReady(workflowId: string, db: DB = getDb()) {
  const tasks = getTasks(workflowId, db);
  const done = new Set(tasks.filter((t) => t.status === "COMPLETED").map((t) => t.task_id));
  for (const t of tasks) {
    if (t.status !== "CREATED") continue;
    const deps: string[] = JSON.parse(t.dependencies_json);
    if (deps.every((d) => done.has(d))) {
      const r = db.prepare(`UPDATE workflow_tasks SET status='READY', updated_at=? WHERE workflow_id=? AND task_id=? AND status='CREATED'`).run(now(), workflowId, t.task_id);
      if (r.changes) emit(workflowId, "task.ready", `"${t.title}" is ready (dependencies satisfied)`, { taskId: t.task_id, db });
    }
  }
}

/** Expired leases => the attempt is failed; task goes to RECOVERING (checkpoint) or READY. */
export function expireLeases(workflowId: string, db: DB = getDb(), at = now()) {
  const tasks = getTasks(workflowId, db).filter((t) => ACTIVE_TASK_STATES.includes(t.status) && t.lease_expires_at !== null && t.lease_expires_at < at);
  for (const t of tasks) {
    emit(workflowId, "lease.expired", `Heartbeat lost from ${t.current_worker}; lease expired`, { taskId: t.task_id, workerId: t.current_worker ?? undefined, level: "error", db });
    if (t.current_worker) db.prepare(`UPDATE workers SET status='OFFLINE' WHERE id=? AND (last_heartbeat IS NULL OR last_heartbeat < ?)`).run(t.current_worker, at - env().LEASE_MS);
    failAttempt(db, t, t.current_attempt_id!, "lease expired (worker heartbeat lost)", t.current_worker);
  }
}

export function deriveStatus(tasks: TaskRow[]): "ACTIVE" | "COMPLETED" | "FAILED" {
  if (tasks.some((t) => t.status === "FAILED")) return "FAILED";
  if (tasks.length && tasks.every((t) => t.status === "COMPLETED")) return "COMPLETED";
  return "ACTIVE";
}

async function startApproved(wf: WorkflowRow, db: DB) {
  const specHash = wf.plan_hash as Hex;
  emit(wf.id, "escrow.starting", "Creating on-chain task commitment and funding escrow on Monad testnet", { db });
  try {
    const r = await createAndFundEscrow(wf.id, specHash, db);
    if (r.ok) setSettlement(wf.id, "FUNDED", null, db);
    else setSettlement(wf.id, "BLOCKED", r.reason, db);
  } catch (err) {
    setSettlement(wf.id, "FAILED", (err as Error).message.slice(0, 300), db);
    emit(wf.id, "escrow.error", `Escrow setup error: ${(err as Error).message.slice(0, 200)}`, { level: "error", db });
  }
  setWorkflowStatus(wf.id, "ACTIVE", db);
  emit(wf.id, "workflow.active", "Workflow active; scheduler releasing tasks", { db });
}

export async function finalize(wf: WorkflowRow, db: DB = getDb()) {
  const tasks = getTasks(wf.id, db);
  const synth = tasks.find((t) => t.capability === "synthesis");
  const fresh = getWorkflow(wf.id, db)!;
  if (fresh.settlement_status === "FUNDED" || fresh.settlement_status === "SETTLING") {
    setSettlement(wf.id, "SETTLING", null, db);
    try {
      const r = await submitAndSettle(wf.id, synth!.result_hash as Hex, db);
      setSettlement(wf.id, r.ok ? "SETTLED" : "FAILED", r.ok ? null : ("reason" in r && r.reason) || "verification failed", db);
    } catch (err) {
      setSettlement(wf.id, "FAILED", (err as Error).message.slice(0, 300), db);
      emit(wf.id, "escrow.error", `Settlement error: ${(err as Error).message.slice(0, 200)}`, { level: "error", db });
    }
  } else if (fresh.settlement_status === "BLOCKED" || fresh.settlement_status === "NOT_STARTED") {
    emit(wf.id, "escrow.blocked", `Settlement not executed: escrow was not funded (${fresh.settlement_note ?? "no escrow"})`, { level: "warn", db });
  }
  setWorkflowStatus(wf.id, "COMPLETED", db);
  emit(wf.id, "workflow.completed", "All tasks completed and verified; final briefing available", { level: "success", db });
}

export async function tick(db: DB = getDb()) {
  const wfs = db.prepare(`SELECT * FROM workflows WHERE status IN ('APPROVED','ACTIVE')`).all() as WorkflowRow[];
  for (const wf of wfs) {
    if (inflight.has(wf.id)) continue;
    if (wf.status === "APPROVED") {
      inflight.add(wf.id);
      startApproved(wf, db).finally(() => inflight.delete(wf.id));
      continue;
    }
    expireLeases(wf.id, db);
    promoteReady(wf.id, db);
    const status = deriveStatus(getTasks(wf.id, db));
    if (status === "FAILED") {
      db.prepare(`UPDATE workflow_tasks SET status='CANCELLED', updated_at=? WHERE workflow_id=? AND status IN ('CREATED','READY')`).run(now(), wf.id);
      setWorkflowStatus(wf.id, "FAILED", db);
      emit(wf.id, "workflow.failed", "Workflow failed: a task exhausted its retry budget. Escrow remains refundable after deadline.", { level: "error", db });
    } else if (status === "COMPLETED") {
      inflight.add(wf.id);
      finalize(wf, db).finally(() => inflight.delete(wf.id));
    }
  }
}

/** Manual settlement retry for a completed workflow (idempotent; reconciles before resending). */
export async function retrySettlement(id: string, db: DB = getDb()) {
  const wf = getWorkflow(id, db);
  if (!wf || wf.status !== "COMPLETED") throw new Error("workflow must be COMPLETED");
  if (wf.settlement_status !== "FAILED") throw new Error(`settlement is ${wf.settlement_status}`);
  const funded = escrowOps(id, db).find((e) => e.action === "FUND")?.status === "CONFIRMED";
  if (!funded) throw new Error("escrow was never funded");
  setSettlement(id, "SETTLING", null, db);
  const synth = getTasks(id, db).find((t) => t.capability === "synthesis")!;
  const r = await submitAndSettle(id, synth.result_hash as Hex, db);
  setSettlement(id, r.ok ? "SETTLED" : "FAILED", r.ok ? null : "settlement verification failed", db);
  return r;
}

export async function reconcileUnknownPayments(db: DB = getDb()) {
  const ops = db.prepare(`SELECT id FROM payment_operations WHERE status IN ('UNKNOWN','SUBMITTED') AND updated_at < ?`).all(now() - 120_000) as { id: string }[];
  for (const o of ops) {
    try {
      await reconcilePayment(o.id, db);
    } catch {
      /* retry next cycle */
    }
  }
}
