import { emit, newId, sha256Hex, stableStringify, storeArtifact, type EventLevel } from "./core";
import { getDb, now, type DB } from "./db";
import { env } from "./env";
import { workerDef } from "./registry";
import { eligibility, getTask, latestCheckpoint, type Checkpoint, type TaskRow } from "./tasks";
import { verifyOutput } from "./verify";

export const CHECKPOINT_SCHEMA_VERSION = 1;

export class WorkerCrash extends Error {}
export class RetryableError extends Error {}

export interface CheckpointState<S> {
  completedSteps: string[];
  state: S;
  artifactIds: string[];
  paymentOpIds: string[];
}

export interface TaskContext<S = Record<string, unknown>> {
  db: DB;
  workflowId: string;
  goal: string;
  task: TaskRow;
  workerId: string;
  attemptId: string;
  attemptNo: number;
  resumedFrom: CheckpointState<S> | null;
  emit: (type: string, message: string, data?: unknown, level?: EventLevel) => void;
  setStep: (step: string) => void;
  saveCheckpoint: (cp: CheckpointState<S>) => void;
  dependencyOutputs: () => Record<string, unknown>;
  isCurrent: () => boolean;
}

export type TaskHandler = (ctx: TaskContext) => Promise<unknown>;

/** Fencing: a write is only valid while this attempt still owns the task lease. */
function owns(db: DB, wf: string, taskId: string, attemptId: string) {
  const r = db
    .prepare(`SELECT current_attempt_id FROM workflow_tasks WHERE workflow_id = ? AND task_id = ?`)
    .get(wf, taskId) as { current_attempt_id: string | null } | undefined;
  return r?.current_attempt_id === attemptId;
}

export function heartbeatWorker(workerId: string, status: "ONLINE" | "BUSY" | "OFFLINE", db: DB = getDb()) {
  db.prepare(
    `UPDATE workers SET status = ?, last_heartbeat = ?, pid = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
  ).run(status, now(), process.pid, now(), workerId);
}

/** Atomically claim one runnable task for this worker. Returns null if nothing is claimable. */
export function claimTask(workerId: string, db: DB = getDb()): { task: TaskRow; attemptId: string; attemptNo: number; kind: string; checkpoint: Checkpoint | null } | null {
  const def = workerDef(workerId);
  return db.transaction(() => {
    const candidates = db
      .prepare(
        `SELECT t.* FROM workflow_tasks t JOIN workflows w ON w.id = t.workflow_id
         WHERE w.status = 'ACTIVE' AND t.status IN ('READY','RECOVERING') ORDER BY t.updated_at`,
      )
      .all() as TaskRow[];
    for (const t of candidates) {
      const el = eligibility(t);
      const isPrimary = el.primary.includes(workerId) && def.capabilities.includes(t.capability as never);
      const isBackup = el.backup.includes(workerId) && def.backupCapabilities.includes(t.capability as never);
      if (t.status === "READY" && !isPrimary) continue;
      if (t.status === "RECOVERING") {
        if (!isPrimary && !isBackup) continue;
        // Prefer a different worker than the one whose attempt just failed.
        const last = db
          .prepare(`SELECT worker_id FROM task_attempts WHERE workflow_id = ? AND task_id = ? ORDER BY attempt_no DESC LIMIT 1`)
          .get(t.workflow_id, t.task_id) as { worker_id: string } | undefined;
        if (last?.worker_id === workerId) {
          const others = [...el.primary, ...el.backup].filter((w) => w !== workerId);
          const othersOnline = db
            .prepare(`SELECT COUNT(*) c FROM workers WHERE id IN (${others.map(() => "?").join(",") || "''"}) AND last_heartbeat > ?`)
            .get(...others, now() - env().LEASE_MS) as { c: number };
          if (othersOnline.c > 0) continue;
        }
      }
      const attemptNo = t.attempts + 1;
      const attemptId = newId("att");
      const kind = t.status === "RECOVERING" ? "RECOVERY" : t.attempts > 0 ? "RETRY" : "INITIAL";
      const res = db
        .prepare(
          `UPDATE workflow_tasks SET status='CLAIMED', attempts=?, current_attempt_id=?, current_worker=?, lease_expires_at=?, error=NULL, updated_at=?
           WHERE workflow_id=? AND task_id=? AND status=? AND attempts=?`,
        )
        .run(attemptNo, attemptId, workerId, now() + env().LEASE_MS, now(), t.workflow_id, t.task_id, t.status, t.attempts);
      if (res.changes !== 1) continue; // lost the race
      const cp = kind === "RECOVERY" ? latestCheckpoint(t.workflow_id, t.task_id, db) ?? null : null;
      db.prepare(
        `INSERT INTO task_attempts (id, workflow_id, task_id, attempt_no, worker_id, kind, status, resumed_from_checkpoint, started_at)
         VALUES (?,?,?,?,?,?, 'RUNNING', ?, ?)`,
      ).run(attemptId, t.workflow_id, t.task_id, attemptNo, workerId, kind, cp?.id ?? null, now());
      emit(
        t.workflow_id,
        kind === "RECOVERY" ? "task.recovery_claimed" : "task.claimed",
        kind === "RECOVERY"
          ? `${def.name} claimed recovery attempt #${attemptNo}${cp ? ` from checkpoint seq ${cp.seq}` : " (no checkpoint; fresh start)"}`
          : `${def.name} claimed task (attempt #${attemptNo})`,
        { taskId: t.task_id, workerId, level: kind === "RECOVERY" ? "warn" : "info", data: { attemptId, checkpointId: cp?.id }, db },
      );
      return { task: getTask(t.workflow_id, t.task_id, db)!, attemptId, attemptNo, kind, checkpoint: cp };
    }
    return null;
  })();
}

export function failAttempt(db: DB, t: Pick<TaskRow, "workflow_id" | "task_id" | "retry_limit" | "attempts">, attemptId: string, reason: string, workerId: string | null) {
  db.transaction(() => {
    db.prepare(`UPDATE task_attempts SET status='FAILED', failure_reason=?, ended_at=? WHERE id=? AND status='RUNNING'`).run(reason, now(), attemptId);
    const cp = latestCheckpoint(t.workflow_id, t.task_id, db);
    const canRetry = t.attempts <= t.retry_limit;
    const next = canRetry ? (cp ? "RECOVERING" : "READY") : "FAILED";
    db.prepare(
      `UPDATE workflow_tasks SET status=?, current_attempt_id=NULL, current_worker=NULL, lease_expires_at=NULL, error=?, updated_at=?
       WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`,
    ).run(next, reason, now(), t.workflow_id, t.task_id, attemptId);
    emit(
      t.workflow_id,
      next === "FAILED" ? "task.failed" : "task.attempt_failed",
      next === "FAILED"
        ? `Task failed permanently after ${t.attempts} attempt(s): ${reason}`
        : `Attempt failed (${reason}); task → ${next}${cp ? ` (checkpoint seq ${cp.seq} available)` : ""}`,
      { taskId: t.task_id, workerId: workerId ?? undefined, level: next === "FAILED" ? "error" : "warn", db },
    );
  })();
}

/** Execute a claimed task end-to-end with heartbeat, timeout, checkpoints, and verification. */
export async function runClaimed(
  workerId: string,
  claim: NonNullable<ReturnType<typeof claimTask>>,
  handler: TaskHandler,
  db: DB = getDb(),
) {
  const { task, attemptId, attemptNo } = claim;
  const wf = db.prepare(`SELECT goal FROM workflows WHERE id = ?`).get(task.workflow_id) as { goal: string };
  const leaseTimer = setInterval(() => {
    db.prepare(`UPDATE workflow_tasks SET lease_expires_at=? WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`).run(
      now() + env().LEASE_MS,
      task.workflow_id,
      task.task_id,
      attemptId,
    );
    heartbeatWorker(workerId, "BUSY", db);
  }, Math.max(500, Math.floor(env().LEASE_MS / 4)));

  let seq = claim.checkpoint?.seq ?? 0;
  const resumedFrom: CheckpointState<Record<string, unknown>> | null = claim.checkpoint
    ? {
        completedSteps: JSON.parse(claim.checkpoint.completed_steps_json),
        state: JSON.parse(claim.checkpoint.state_json),
        artifactIds: JSON.parse(claim.checkpoint.artifact_ids_json),
        paymentOpIds: JSON.parse(claim.checkpoint.payment_op_ids_json),
      }
    : null;
  if (claim.checkpoint && resumedFrom) {
    const ok = sha256Hex(stableStringify(resumedFrom.state)) === claim.checkpoint.state_hash;
    if (!ok) throw new Error("checkpoint integrity check failed (state hash mismatch)");
    emit(task.workflow_id, "checkpoint.loaded", `Loaded checkpoint seq ${claim.checkpoint.seq}: steps done = [${resumedFrom.completedSteps.join(", ")}]`, {
      taskId: task.task_id,
      workerId,
      level: "success",
      data: { checkpointId: claim.checkpoint.id, completedSteps: resumedFrom.completedSteps, paymentOpIds: resumedFrom.paymentOpIds },
      db,
    });
  }

  const ctx: TaskContext = {
    db,
    workflowId: task.workflow_id,
    goal: wf.goal,
    task,
    workerId,
    attemptId,
    attemptNo,
    resumedFrom,
    emit: (type, message, data, level) => emit(task.workflow_id, type, message, { taskId: task.task_id, workerId, data, level, db }),
    isCurrent: () => owns(db, task.workflow_id, task.task_id, attemptId),
    setStep: (step) => {
      db.prepare(`UPDATE workflow_tasks SET current_step=?, status=CASE WHEN status='CLAIMED' THEN 'RUNNING' ELSE status END, updated_at=? WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`).run(
        step,
        now(),
        task.workflow_id,
        task.task_id,
        attemptId,
      );
    },
    saveCheckpoint: (cp) => {
      if (!owns(db, task.workflow_id, task.task_id, attemptId)) throw new WorkerCrash("lease lost; refusing to write checkpoint");
      seq += 1;
      const id = newId("cp");
      db.prepare(
        `INSERT INTO task_checkpoints (id, workflow_id, task_id, attempt_id, worker_id, seq, schema_version, completed_steps_json, state_json, artifact_ids_json, payment_op_ids_json, state_hash, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        task.workflow_id,
        task.task_id,
        attemptId,
        workerId,
        seq,
        CHECKPOINT_SCHEMA_VERSION,
        JSON.stringify(cp.completedSteps),
        JSON.stringify(cp.state),
        JSON.stringify(cp.artifactIds),
        JSON.stringify(cp.paymentOpIds),
        sha256Hex(stableStringify(cp.state)),
        now(),
      );
      db.prepare(`UPDATE workflow_tasks SET status='CHECKPOINTED', updated_at=? WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`).run(
        now(),
        task.workflow_id,
        task.task_id,
        attemptId,
      );
      emit(task.workflow_id, "checkpoint.saved", `Checkpoint seq ${seq} saved after "${cp.completedSteps.at(-1)}"`, {
        taskId: task.task_id,
        workerId,
        data: { checkpointId: id, seq, completedSteps: cp.completedSteps },
        db,
      });
      // Controlled fault injection: crash this worker process right after a durable checkpoint.
      const fault = db
        .prepare(`SELECT id FROM fault_injections WHERE workflow_id=? AND task_id=? AND worker_id=? AND status='ARMED'`)
        .get(task.workflow_id, task.task_id, workerId) as { id: string } | undefined;
      if (fault) {
        db.prepare(`UPDATE fault_injections SET status='FIRED', fired_at=? WHERE id=?`).run(now(), fault.id);
        emit(task.workflow_id, "worker.crash", `Injected failure: ${workerDef(workerId).name} process is terminating mid-task`, {
          taskId: task.task_id,
          workerId,
          level: "error",
          data: { pid: process.pid, faultId: fault.id },
          db,
        });
        throw new WorkerCrash("injected crash");
      }
    },
    dependencyOutputs: () => {
      const deps: string[] = JSON.parse(task.dependencies_json);
      const out: Record<string, unknown> = {};
      for (const d of deps) {
        const r = db
          .prepare(`SELECT a.content FROM workflow_tasks t JOIN artifacts a ON a.id = t.result_artifact_id WHERE t.workflow_id=? AND t.task_id=? AND t.status='COMPLETED'`)
          .get(task.workflow_id, d) as { content: string } | undefined;
        if (!r) throw new Error(`dependency ${d} has no completed output`);
        out[d] = JSON.parse(r.content);
      }
      return out;
    },
  };

  try {
    ctx.setStep("starting");
    const output = await Promise.race([
      handler(ctx),
      new Promise((_, rej) => setTimeout(() => rej(new RetryableError(`timeout after ${task.timeout_ms}ms`)), task.timeout_ms)),
    ]);
    if (!ctx.isCurrent()) throw new WorkerCrash("lease lost before completion; discarding output");
    db.prepare(`UPDATE workflow_tasks SET status='VERIFYING', current_step='verifying output', updated_at=? WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`).run(
      now(),
      task.workflow_id,
      task.task_id,
      attemptId,
    );
    const content = JSON.stringify(output);
    const art = storeArtifact({ workflowId: task.workflow_id, taskId: task.task_id, kind: `${task.capability}-output`, mime: "application/json", content, producedBy: workerId }, db);
    const report = verifyOutput(task, output, art.id, db);
    ctx.emit("task.verification", `Verification ${report.passed ? "passed" : "FAILED"}: ${report.checks.filter((c) => c.passed).length}/${report.checks.length} checks`, report, report.passed ? "success" : "error");
    if (!report.passed) {
      clearInterval(leaseTimer);
      failAttempt(db, getTask(task.workflow_id, task.task_id, db)!, attemptId, `verification failed: ${report.checks.filter((c) => !c.passed).map((c) => c.id).join(",")}`, workerId);
      return;
    }
    db.transaction(() => {
      const r = db
        .prepare(
          `UPDATE workflow_tasks SET status='COMPLETED', result_artifact_id=?, result_hash=?, current_step='done', lease_expires_at=NULL, updated_at=?
           WHERE workflow_id=? AND task_id=? AND current_attempt_id=?`,
        )
        .run(art.id, art.sha256, now(), task.workflow_id, task.task_id, attemptId);
      if (r.changes !== 1) throw new WorkerCrash("lease lost during completion");
      db.prepare(`UPDATE task_attempts SET status='SUCCEEDED', ended_at=? WHERE id=?`).run(now(), attemptId);
      db.prepare(`INSERT INTO artifacts (id, workflow_id, task_id, kind, mime, content, sha256, produced_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
        newId("art"),
        task.workflow_id,
        task.task_id,
        "verification-report",
        "application/json",
        JSON.stringify(report),
        sha256Hex(JSON.stringify(report)),
        "verifier",
        now(),
      );
    })();
    ctx.emit("task.completed", `Task completed and verified (artifact ${art.sha256.slice(0, 18)}…)`, { artifactId: art.id, sha256: art.sha256 }, "success");
  } catch (err) {
    if (err instanceof WorkerCrash && err.message === "injected crash") {
      clearInterval(leaseTimer);
      throw err; // propagate: the worker process exits for real
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.isCurrent()) failAttempt(db, getTask(task.workflow_id, task.task_id, db)!, attemptId, msg.slice(0, 300), workerId);
    else emit(task.workflow_id, "task.stale_attempt", `Stale attempt ${attemptId} ended: ${msg}`, { taskId: task.task_id, workerId, level: "warn", db });
  } finally {
    clearInterval(leaseTimer);
  }
}
