import { openDb, setDbForTests, type DB } from "../../src/server/db";
import { seedWorkers } from "../../src/server/registry";
import { createWorkflow } from "../../src/server/workflows";

export const BUDGET = { x402Usdc: 0.05, perCallUsdc: 0.02, approvalThresholdUsdc: 0.015, escrowMon: 0.01, gasMon: 0.05 };

export function freshDb(): DB {
  const db = openDb(":memory:");
  setDbForTests(db);
  seedWorkers(db);
  return db;
}

/** Create a workflow with the rule-based planner and mark it ACTIVE (escrow skipped). */
export async function activeWorkflow(db: DB, budget = BUDGET) {
  const id = await createWorkflow("Research the Monad ecosystem and generate an actionable technical briefing.", budget, "operator", db);
  db.prepare(`UPDATE workflows SET status='ACTIVE', approved_at=? WHERE id=?`).run(Date.now(), id);
  return id;
}

export function markOnline(db: DB, ...workers: string[]) {
  for (const w of workers) db.prepare(`UPDATE workers SET last_heartbeat=?, status='ONLINE' WHERE id=?`).run(Date.now(), w);
}
