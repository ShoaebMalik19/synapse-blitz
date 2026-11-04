/** Headless end-to-end run: create -> approve (with failure drill) -> wait for completion. Requires orchestrator + workers + paid-data running. */
import { getDb } from "../src/server/db";
import { approveWorkflow, createWorkflow, workflowView } from "../src/server/workflows";
import { sleep } from "../src/server/core";

async function main() {
const drill = process.argv.includes("--drill");
const db = getDb();
const id = await createWorkflow("Research the Monad ecosystem and generate an actionable technical briefing.", {
  x402Usdc: 0.05, perCallUsdc: 0.02, approvalThresholdUsdc: 0.015, escrowMon: 0.01, gasMon: 0.05,
}, "operator", db);
console.log("workflow", id);
approveWorkflow(id, { failureDrill: drill, approveHighValue: false }, db);
let last = 0;
for (let i = 0; i < 240; i++) {
  await sleep(1000);
  const ev = db.prepare(`SELECT id, type, worker_id, task_id, message FROM workflow_events WHERE workflow_id = ? AND id > ? ORDER BY id`).all(id, last) as any[];
  for (const e of ev) { console.log(`  [${e.type}] ${e.worker_id ?? ""} ${e.task_id ?? ""} ${e.message}`); last = e.id; }
  const v = workflowView(id, db)!;
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(v.workflow.status) && !["SETTLING"].includes(v.workflow.settlementStatus)) {
    console.log("FINAL", v.workflow.status, "settlement:", v.workflow.settlementStatus, v.workflow.settlementNote ?? "");
    console.log(v.tasks.map((t) => `${t.taskId}:${t.status}:attempts=${t.attempts}`).join("  "));
    break;
  }
}
}
main().then(() => process.exit(0));
