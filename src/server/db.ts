import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

export type DB = Database.Database;

const SCHEMA_VERSION = 2;

const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,              -- DRAFT | APPROVAL_REQUIRED | ACTIVE | COMPLETED | FAILED | CANCELLED
    planner TEXT NOT NULL,             -- 'llm:<model>' | 'rule-based'
    plan_json TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    budget_json TEXT NOT NULL,
    owner TEXT NOT NULL,
    approved_at INTEGER,
    settlement_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
    settlement_note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    backup_capabilities_json TEXT NOT NULL,
    payee_address TEXT,
    cost_json TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OFFLINE',
    pid INTEGER,
    last_heartbeat INTEGER,
    started_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS workflow_tasks (
    workflow_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    capability TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    eligible_workers_json TEXT NOT NULL,
    estimated_cost_json TEXT NOT NULL,
    max_cost_json TEXT NOT NULL,
    retry_limit INTEGER NOT NULL,
    timeout_ms INTEGER NOT NULL,
    verification_json TEXT NOT NULL,
    status TEXT NOT NULL,              -- CREATED READY CLAIMED RUNNING CHECKPOINTED VERIFYING COMPLETED FAILED RECOVERING CANCELLED
    attempts INTEGER NOT NULL DEFAULT 0,
    current_attempt_id TEXT,
    current_worker TEXT,
    lease_expires_at INTEGER,
    current_step TEXT,
    result_artifact_id TEXT,
    result_hash TEXT,
    error TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workflow_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS task_attempts (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    worker_id TEXT NOT NULL,
    kind TEXT NOT NULL,                -- INITIAL | RETRY | RECOVERY
    status TEXT NOT NULL,              -- RUNNING | SUCCEEDED | FAILED
    resumed_from_checkpoint TEXT,
    failure_reason TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    UNIQUE (workflow_id, task_id, attempt_no)
  );

  CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    completed_steps_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    artifact_ids_json TEXT NOT NULL,
    payment_op_ids_json TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    task_id TEXT,
    worker_id TEXT,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    data_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_wf ON workflow_events (workflow_id, id);

  CREATE TABLE IF NOT EXISTS payment_operations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    workflow_id TEXT NOT NULL,
    task_id TEXT,
    kind TEXT NOT NULL,                -- X402
    provider TEXT NOT NULL,
    resource_url TEXT NOT NULL,
    network TEXT,
    asset TEXT,
    pay_to TEXT,
    amount_base TEXT NOT NULL,
    status TEXT NOT NULL,              -- REJECTED RESERVED SUBMITTED CONFIRMED RELEASED FAILED UNKNOWN
    status_reason TEXT,
    authorization_nonce TEXT,
    payer TEXT,
    tx_hash TEXT,
    explorer_url TEXT,
    verification_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS escrow_operations (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    onchain_task_id TEXT NOT NULL,
    action TEXT NOT NULL,              -- CREATE FUND SUBMIT ACCEPT REFUND GAS_TOPUP
    status TEXT NOT NULL,              -- PENDING SUBMITTED CONFIRMED FAILED BLOCKED
    status_reason TEXT,
    from_address TEXT,
    amount_wei TEXT,
    tx_hash TEXT,
    explorer_url TEXT,
    block_number INTEGER,
    verification_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (workflow_id, action)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    task_id TEXT,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    content TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    produced_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fault_injections (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    mode TEXT NOT NULL,                -- CRASH_AFTER_CHECKPOINT
    status TEXT NOT NULL,              -- ARMED | FIRED
    created_at INTEGER NOT NULL,
    fired_at INTEGER
  );
  `,
  /* v2: planner provenance per draft */ `
  ALTER TABLE workflows ADD COLUMN planner_meta_json TEXT;
  `,
];

function dbPath(): string {
  const url = env().DATABASE_URL;
  const p = url.startsWith("file:") ? url.slice(5) : url;
  return p === ":memory:" ? p : path.resolve(process.cwd(), p);
}

export function openDb(file?: string): DB {
  const p = file ?? dbPath();
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p, { timeout: 10_000 });
  db.pragma("busy_timeout = 10000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  // IMMEDIATE transaction so concurrent processes starting together serialize their migrations.
  db.transaction(() => {
    const current = db.pragma("user_version", { simple: true }) as number;
    for (let v = current; v < SCHEMA_VERSION; v++) {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    }
  }).immediate();
}

const g = globalThis as unknown as { __synapseDb?: DB };
export function getDb(): DB {
  if (!g.__synapseDb) g.__synapseDb = openDb();
  return g.__synapseDb;
}
export function setDbForTests(db: DB) {
  g.__synapseDb = db;
}

export const now = () => Date.now();
