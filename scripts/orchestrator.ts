/** Persistent orchestrator process: scheduling, lease expiry, escrow lifecycle, payment reconciliation. */
import { getDb } from "../src/server/db";
import { seedWorkers } from "../src/server/registry";
import { reconcileUnknownPayments, recoverOrphanedSettlements, tick } from "../src/server/orchestrator";
import { env } from "../src/server/env";

const db = getDb();
seedWorkers(db);
const orphaned = recoverOrphanedSettlements(db);
if (orphaned) console.log(`[orchestrator] marked ${orphaned} interrupted settlement(s) as FAILED (retryable)`);
console.log(`[orchestrator] pid=${process.pid} db=${env().DATABASE_URL} lease=${env().LEASE_MS}ms chain=${env().MONAD_CHAIN_ID} escrow=${env().MONAD_ESCROW_ADDRESS ?? "(not deployed)"}`);

let n = 0;
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await tick(db);
    if (++n % 10 === 0) await reconcileUnknownPayments(db);
  } catch (err) {
    console.error("[orchestrator] tick error", err);
  } finally {
    busy = false;
  }
}, 1000);
