/** A worker process. Usage: tsx scripts/worker.ts worker-a */
import { getDb } from "../src/server/db";
import { seedWorkers, workerDef } from "../src/server/registry";
import { claimTask, heartbeatWorker, runClaimed, WorkerCrash, type TaskHandler } from "../src/server/runtime";
import { researchHandler } from "../src/server/workers/research";
import { analysisHandler } from "../src/server/workers/analysis";
import { synthesisHandler } from "../src/server/workers/synthesis";

const workerId = process.argv[2];
const def = workerDef(workerId);
const handlers: Record<string, TaskHandler> = { research: researchHandler, analysis: analysisHandler, synthesis: synthesisHandler };

const db = getDb();
seedWorkers(db);
heartbeatWorker(workerId, "ONLINE", db);
console.log(`[${workerId}] ${def.name} online pid=${process.pid} caps=${def.capabilities.join(",")} backup=${def.backupCapabilities.join(",") || "-"}`);

let running = false;
setInterval(() => heartbeatWorker(workerId, running ? "BUSY" : "ONLINE", db), 2000);

async function loop() {
  if (running) return;
  const claim = claimTask(workerId, db);
  if (!claim) return;
  running = true;
  heartbeatWorker(workerId, "BUSY", db);
  console.log(`[${workerId}] claimed ${claim.task.workflow_id}/${claim.task.task_id} (${claim.kind} #${claim.attemptNo})`);
  try {
    await runClaimed(workerId, claim, handlers[claim.task.capability], db);
  } catch (err) {
    if (err instanceof WorkerCrash) {
      console.error(`[${workerId}] CRASH (injected) — exiting process with code 137`);
      // Real process termination: no cleanup, no lease release. The orchestrator must detect it.
      process.exit(137);
    }
    console.error(`[${workerId}] unexpected error`, err);
  } finally {
    running = false;
  }
  heartbeatWorker(workerId, "ONLINE", db);
}

setInterval(() => void loop(), 1000);
process.on("SIGINT", () => {
  heartbeatWorker(workerId, "OFFLINE", db);
  process.exit(0);
});
