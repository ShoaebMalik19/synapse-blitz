import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, setDbForTests, type DB } from "../../src/server/db";
import { deriveStatus, expireLeases, promoteReady } from "../../src/server/orchestrator";
import { claimTask, runClaimed, WorkerCrash, type TaskContext } from "../../src/server/runtime";
import { getTask, getTasks, latestCheckpoint } from "../../src/server/tasks";
import { armFailure } from "../../src/server/workflows";
import { activeWorkflow, freshDb, markOnline } from "./helpers";

let db: DB;
let wf: string;

beforeEach(async () => {
  db = freshDb();
  wf = await activeWorkflow(db);
  markOnline(db, "worker-a", "worker-b");
});

/** A replay-aware handler: counts side effects so tests can assert nothing is repeated. */
function stepHandler(effects: string[]) {
  return async (ctx: TaskContext) => {
    const done = new Set(ctx.resumedFrom?.completedSteps ?? []);
    const state = { ...(ctx.resumedFrom?.state ?? {}) } as Record<string, unknown>;
    for (const step of ["paid_purchase", "source_1", "source_2"]) {
      if (done.has(step)) continue;
      effects.push(`${ctx.workerId}:${step}`);
      state[step] = true;
      done.add(step);
      ctx.saveCheckpoint({ completedSteps: [...done], state, artifactIds: [], paymentOpIds: step === "paid_purchase" ? ["pay_1"] : [] });
    }
    return {
      sources: [1, 2, 3].map((i) => ({ id: `s${i}`, url: `https://example.org/${i}`, title: "t", kind: "api" })),
      facts: [1, 2, 3].map((i) => ({ id: `F${i}`, sourceId: `s${i}`, claim: "c" })),
      dataset: { status: "BLOCKED", reason: "test" },
    };
  };
}

describe("scheduler", () => {
  it("never makes a task runnable before its dependencies complete", () => {
    promoteReady(wf, db);
    const s = Object.fromEntries(getTasks(wf, db).map((t) => [t.task_id, t.status]));
    expect(s).toEqual({ research: "READY", analysis: "CREATED", briefing: "CREATED" });
    // worker-b cannot claim analysis (not READY) nor research (primary is worker-a, READY not RECOVERING)
    expect(claimTask("worker-b", db)).toBeNull();
  });

  it("only one worker can claim a task (no concurrent duplicate execution)", () => {
    promoteReady(wf, db);
    const a = claimTask("worker-a", db);
    const again = claimTask("worker-a", db);
    expect(a?.task.task_id).toBe("research");
    expect(again).toBeNull();
    expect(getTask(wf, "research", db)!.status).toBe("CLAIMED");
    const attempts = db.prepare(`SELECT COUNT(*) c FROM task_attempts WHERE workflow_id=?`).get(wf) as { c: number };
    expect(attempts.c).toBe(1);
  });

  it("injected crash after a checkpoint -> lease expiry -> RECOVERING -> other worker resumes without repeating side effects", async () => {
    promoteReady(wf, db);
    armFailure(wf, db);
    const effects: string[] = [];
    const claim = claimTask("worker-a", db)!;
    await expect(runClaimed("worker-a", claim, stepHandler(effects), db)).rejects.toBeInstanceOf(WorkerCrash);
    expect(effects).toEqual(["worker-a:paid_purchase"]);
    expect(latestCheckpoint(wf, "research", db)!.seq).toBe(1);

    // Simulate time passing beyond the lease without heartbeats.
    expireLeases(wf, db, Date.now() + 60_000);
    expect(getTask(wf, "research", db)!.status).toBe("RECOVERING");

    // Worker A restarted: must not take back the task while worker B is online.
    expect(claimTask("worker-a", db)).toBeNull();
    const rec = claimTask("worker-b", db)!;
    expect(rec.kind).toBe("RECOVERY");
    expect(rec.checkpoint?.seq).toBe(1);
    await runClaimed("worker-b", rec, stepHandler(effects), db);

    expect(effects).toEqual(["worker-a:paid_purchase", "worker-b:source_1", "worker-b:source_2"]);
    const t = getTask(wf, "research", db)!;
    expect(t.status).toBe("COMPLETED");
    expect(t.attempts).toBe(2);
    const atts = db.prepare(`SELECT worker_id, kind, status, resumed_from_checkpoint FROM task_attempts WHERE workflow_id=? ORDER BY attempt_no`).all(wf) as {
      worker_id: string;
      kind: string;
      status: string;
      resumed_from_checkpoint: string | null;
    }[];
    expect(atts.map((a) => `${a.worker_id}:${a.kind}:${a.status}`)).toEqual(["worker-a:INITIAL:FAILED", "worker-b:RECOVERY:SUCCEEDED"]);
    expect(atts[1].resumed_from_checkpoint).toBeTruthy();
  });

  it("a stale (fenced-out) attempt can never mark a task successful", async () => {
    promoteReady(wf, db);
    const claim = claimTask("worker-a", db)!;
    expireLeases(wf, db, Date.now() + 60_000); // attempt 1 fenced out
    const slow = async () => ({ sources: [], facts: [] });
    await runClaimed("worker-a", claim, slow, db);
    const t = getTask(wf, "research", db)!;
    expect(t.status).not.toBe("COMPLETED");
    const a = db.prepare(`SELECT status FROM task_attempts WHERE id=?`).get(claim.attemptId) as { status: string };
    expect(a.status).toBe("FAILED");
  });

  it("failed verification fails the attempt; exhausting retries marks the task and workflow FAILED", async () => {
    promoteReady(wf, db);
    db.prepare(`UPDATE workflow_tasks SET retry_limit=1 WHERE workflow_id=? AND task_id='research'`).run(wf);
    const bad = async () => ({ sources: [], facts: [] }); // fails deterministic verification
    for (let i = 0; i < 2; i++) {
      const c = claimTask("worker-a", db)!;
      await runClaimed("worker-a", c, bad, db);
    }
    expect(getTask(wf, "research", db)!.status).toBe("FAILED");
    expect(deriveStatus(getTasks(wf, db))).toBe("FAILED");
    expect(claimTask("worker-a", db)).toBeNull();
  });

  it("enforces task timeouts", async () => {
    promoteReady(wf, db);
    db.prepare(`UPDATE workflow_tasks SET timeout_ms=50 WHERE workflow_id=? AND task_id='research'`).run(wf);
    const c = claimTask("worker-a", db)!;
    await runClaimed("worker-a", c, () => new Promise((r) => setTimeout(r, 1000)), db);
    expect(getTask(wf, "research", db)!.error).toMatch(/timeout/);
  });

  it("workflow state survives process restart (durable SQLite file)", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "synapse-")), "t.db");
    const d1 = openDb(file);
    setDbForTests(d1);
    const { seedWorkers } = await import("../../src/server/registry");
    seedWorkers(d1);
    const id = await activeWorkflow(d1);
    promoteReady(id, d1);
    claimTask("worker-a", d1);
    d1.close();
    const d2 = openDb(file);
    const t = d2.prepare(`SELECT status, attempts FROM workflow_tasks WHERE workflow_id=? AND task_id='research'`).get(id) as { status: string; attempts: number };
    expect(t).toEqual({ status: "CLAIMED", attempts: 1 });
    const ev = d2.prepare(`SELECT COUNT(*) c FROM workflow_events WHERE workflow_id=?`).get(id) as { c: number };
    expect(ev.c).toBeGreaterThan(3);
    d2.close();
  });
});

describe("checkpoint integrity", () => {
  it("refuses to resume from a tampered checkpoint", async () => {
    promoteReady(wf, db);
    armFailure(wf, db);
    const claim = claimTask("worker-a", db)!;
    await expect(runClaimed("worker-a", claim, stepHandler([]), db)).rejects.toBeInstanceOf(WorkerCrash);
    db.prepare(`UPDATE task_checkpoints SET state_json='{"paid_purchase":false}' WHERE workflow_id=?`).run(wf);
    expireLeases(wf, db, Date.now() + 60_000);
    const rec = claimTask("worker-b", db)!;
    const spy = vi.fn();
    await expect(runClaimed("worker-b", rec, spy, db)).rejects.toThrow(/integrity/);
    expect(spy).not.toHaveBeenCalled();
  });
});
