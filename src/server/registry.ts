import { getDb, type DB } from "./db";

/**
 * PROTOTYPE REGISTRY — statically configured worker identities.
 * This is NOT a permissionless marketplace: workers are allowlisted here by the operator.
 */
export type Capability = "research" | "analysis" | "synthesis";
export const CAPABILITIES: Capability[] = ["research", "analysis", "synthesis"];

export interface WorkerDef {
  id: string;
  name: string;
  kind: string;
  description: string;
  capabilities: Capability[];
  /** Capabilities this worker may take over ONLY when resuming from a checkpoint (failover). */
  backupCapabilities: Capability[];
  payeeEnv: "WORKER_A_ADDRESS" | "WORKER_B_ADDRESS";
  cost: { perTaskMon: string; note: string };
  timeoutMs: number;
}

export const WORKERS: WorkerDef[] = [
  {
    id: "worker-a",
    name: "Worker A · Research",
    kind: "research-agent",
    description:
      "Buys the paid Monad ecosystem dataset via x402, then fetches allowlisted public sources (Monad docs, GitHub) and extracts structured, cited facts.",
    capabilities: ["research"],
    backupCapabilities: [],
    payeeEnv: "WORKER_A_ADDRESS",
    cost: { perTaskMon: "0.002", note: "plus x402 data purchases (USDC, separate budget)" },
    timeoutMs: 90_000,
  },
  {
    id: "worker-b",
    name: "Worker B · Analysis",
    kind: "analysis-agent",
    description:
      "Analyzes research output into ranked, actionable insights and synthesizes the cited briefing. Registered as checkpoint-resume backup for research.",
    capabilities: ["analysis", "synthesis"],
    backupCapabilities: ["research"],
    payeeEnv: "WORKER_B_ADDRESS",
    cost: { perTaskMon: "0.002", note: "escrow payout on accepted report" },
    timeoutMs: 90_000,
  },
];

export function workerDef(id: string): WorkerDef {
  const w = WORKERS.find((x) => x.id === id);
  if (!w) throw new Error(`unknown worker ${id}`);
  return w;
}

export function seedWorkers(db: DB = getDb()) {
  const stmt = db.prepare(
    `INSERT INTO workers (id, name, kind, capabilities_json, backup_capabilities_json, payee_address, cost_json, timeout_ms)
     VALUES (@id,@name,@kind,@caps,@backup,@payee,@cost,@timeout)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, capabilities_json=excluded.capabilities_json,
       backup_capabilities_json=excluded.backup_capabilities_json, payee_address=excluded.payee_address,
       cost_json=excluded.cost_json, timeout_ms=excluded.timeout_ms`,
  );
  for (const w of WORKERS) {
    stmt.run({
      id: w.id,
      name: w.name,
      kind: w.kind,
      caps: JSON.stringify(w.capabilities),
      backup: JSON.stringify(w.backupCapabilities),
      payee: process.env[w.payeeEnv] ?? null,
      cost: JSON.stringify(w.cost),
      timeout: w.timeoutMs,
    });
  }
}

export function eligibleWorkersFor(cap: Capability): { primary: string[]; backup: string[] } {
  return {
    primary: WORKERS.filter((w) => w.capabilities.includes(cap)).map((w) => w.id),
    backup: WORKERS.filter((w) => w.backupCapabilities.includes(cap)).map((w) => w.id),
  };
}
