import { getDb, now, type DB } from "./db";
import type { PlannedTask } from "./planner";

export type TaskStatus =
  | "CREATED"
  | "READY"
  | "CLAIMED"
  | "RUNNING"
  | "CHECKPOINTED"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "RECOVERING"
  | "CANCELLED";

export const ACTIVE_TASK_STATES: TaskStatus[] = ["CLAIMED", "RUNNING", "CHECKPOINTED", "VERIFYING"];

export interface TaskRow {
  workflow_id: string;
  task_id: string;
  title: string;
  description: string;
  capability: string;
  dependencies_json: string;
  eligible_workers_json: string;
  estimated_cost_json: string;
  max_cost_json: string;
  retry_limit: number;
  timeout_ms: number;
  verification_json: string;
  status: TaskStatus;
  attempts: number;
  current_attempt_id: string | null;
  current_worker: string | null;
  lease_expires_at: number | null;
  current_step: string | null;
  result_artifact_id: string | null;
  result_hash: string | null;
  error: string | null;
  updated_at: number;
}

export interface Checkpoint {
  id: string;
  workflow_id: string;
  task_id: string;
  attempt_id: string;
  worker_id: string;
  seq: number;
  schema_version: number;
  completed_steps_json: string;
  state_json: string;
  artifact_ids_json: string;
  payment_op_ids_json: string;
  state_hash: string;
  created_at: number;
}

export function eligibility(t: TaskRow): { primary: string[]; backup: string[] } {
  const j = JSON.parse(t.eligible_workers_json);
  return Array.isArray(j) ? { primary: j, backup: [] } : j;
}

export function insertPlanTasks(workflowId: string, tasks: PlannedTask[], db: DB = getDb()) {
  const stmt = db.prepare(
    `INSERT INTO workflow_tasks (workflow_id, task_id, title, description, capability, dependencies_json, eligible_workers_json,
       estimated_cost_json, max_cost_json, retry_limit, timeout_ms, verification_json, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'CREATED', ?)`,
  );
  for (const t of tasks) {
    stmt.run(
      workflowId,
      t.taskId,
      t.title,
      t.description,
      t.capability,
      JSON.stringify(t.dependencies),
      JSON.stringify({ primary: t.eligibleWorkers, backup: t.backupWorkers }),
      JSON.stringify(t.estimatedCost),
      JSON.stringify(t.maxCost),
      t.retryLimit,
      t.timeoutMs,
      JSON.stringify(t.verificationCriteria),
      now(),
    );
  }
}

export function getTasks(workflowId: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM workflow_tasks WHERE workflow_id = ? ORDER BY rowid`).all(workflowId) as TaskRow[];
}
export function getTask(workflowId: string, taskId: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM workflow_tasks WHERE workflow_id = ? AND task_id = ?`).get(workflowId, taskId) as
    | TaskRow
    | undefined;
}

export function latestCheckpoint(workflowId: string, taskId: string, db: DB = getDb()) {
  return db
    .prepare(`SELECT * FROM task_checkpoints WHERE workflow_id = ? AND task_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1`)
    .get(workflowId, taskId) as Checkpoint | undefined;
}
