"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body.issues);
  return body as T;
}

export const shortHash = (h?: string | null, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : "—");
export const fmtUsdc = (base?: string | null) => (base == null ? "—" : String(Number(base) / 1e6));
export const fmtMon = (wei?: string | null, dp = 4) => (wei == null ? "—" : (Number(wei) / 1e18).toFixed(dp));
export const timeAgo = (t?: number | null) => {
  if (!t) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};
export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ---------- shared response types ----------
export interface NetworkStatus {
  chain: { expectedChainId: number; rpcChainId: number | null; match: boolean; rpc: string; blockNumber: string | null; explorer: string; error: string | null };
  operator: { address: string; explorer: string; balances: { monWei: string; usdcBase: string | null } | null; error: string | null } | null;
  escrow: { address: string | null; deployed: boolean; explorer: string | null };
  x402: { facilitator: string; network: string; asset: string; payTo: string | null; exactSupported: boolean; facilitatorError: string | null; service: { online: boolean; url: string; error?: string } };
  llm: { configured: boolean; model: string | null };
  policyDefaults: Budget;
}
export interface Budget {
  x402Usdc: number;
  perCallUsdc: number;
  approvalThresholdUsdc: number;
  escrowMon: number;
  gasMon: number;
}
export interface WorkerInfo {
  id: string;
  name: string;
  kind: string;
  description: string;
  capabilities: string[];
  backupCapabilities: string[];
  payee: string | null;
  status: string;
  lastHeartbeat: number | null;
  pid: number | null;
  cost: { perTaskMon: string; note: string };
}
export interface WorkflowListItem {
  id: string;
  goal: string;
  status: string;
  planner: string;
  settlement_status: string;
  created_at: number;
  task_count: number;
  completed_count: number;
}
export interface TaskView {
  taskId: string;
  title: string;
  description: string;
  capability: string;
  dependencies: string[];
  eligibleWorkers: { primary: string[]; backup: string[] };
  estimatedCost: { usdc: number; mon: number };
  maxCost: { usdc: number; mon: number };
  retryLimit: number;
  timeoutMs: number;
  verificationCriteria: string[];
  status: string;
  attempts: number;
  currentWorker: string | null;
  currentStep: string | null;
  leaseExpiresAt: number | null;
  resultHash: string | null;
  error: string | null;
}
export interface Attempt {
  id: string;
  task_id: string;
  attempt_no: number;
  worker_id: string;
  kind: string;
  status: string;
  resumed_from_checkpoint: string | null;
  failure_reason: string | null;
  started_at: number;
  ended_at: number | null;
}
export interface CheckpointRow {
  id: string;
  task_id: string;
  worker_id: string;
  seq: number;
  schema_version: number;
  completed_steps_json: string;
  payment_op_ids_json: string;
  state_hash: string;
  created_at: number;
}
export interface BudgetSummary {
  x402: { unit: string; capBase: string; estimatedBase: string; reservedBase: string; confirmedBase: string; releasedBase: string; failedBase: string; unknownBase: string; rejectedBase: string };
  escrow: { unit: string; capWei: string };
  gas: { unit: string; capWei: string };
}
export interface WorkflowDetail {
  workflow: {
    id: string;
    goal: string;
    status: string;
    planner: string;
    plan: { summary: string; totalEstimatedUsdc: number };
    planHash: string;
    settlementStatus: string;
    settlementNote: string | null;
    createdAt: number;
    approvedAt: number | null;
  };
  tasks: TaskView[];
  attempts: Attempt[];
  checkpoints: CheckpointRow[];
  faults: { id: string; task_id: string; worker_id: string; status: string; created_at: number; fired_at: number | null }[];
  budget: BudgetSummary;
}
export interface EventRow {
  id: number;
  task_id: string | null;
  worker_id: string | null;
  type: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  data: Record<string, unknown> | null;
  created_at: number;
}
export interface PaymentRow {
  id: string;
  task_id: string | null;
  provider: string;
  resource_url: string;
  network: string | null;
  asset: string | null;
  pay_to: string | null;
  amount_base: string;
  status: string;
  status_reason: string | null;
  authorization_nonce: string | null;
  payer: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  verification: { onchain?: { verified: boolean; blockNumber?: string; reason?: string; transfer?: { from: string; to: string; value: string } } } | null;
  created_at: number;
}
export interface EscrowRow {
  id: string;
  action: string;
  status: string;
  status_reason: string | null;
  from_address: string | null;
  amount_wei: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  block_number: number | null;
  onchain_task_id: string;
  verification: Record<string, unknown> | null;
}
export interface PaymentsResponse {
  payments: PaymentRow[];
  escrow: EscrowRow[];
  budget: BudgetSummary;
  escrowContract: { address: string; explorer: string } | null;
}

/**
 * Human label for an x402 payment op. Makes it impossible to read a blocked/rejected purchase as paid:
 * only CONFIRMED (Transfer log verified on-chain) is shown as "PAID".
 */
export function paymentLabel(p: { status: string; status_reason: string | null }): { label: string; charged: boolean; tone: "ok" | "warn" | "bad" | "violet" } {
  switch (p.status) {
    case "CONFIRMED":
      return { label: "PAID · VERIFIED ON-CHAIN", charged: true, tone: "ok" };
    case "REJECTED":
      return { label: "REJECTED · NOT SIGNED", charged: false, tone: "bad" };
    case "RELEASED":
      return { label: p.status_reason?.startsWith("blocked") ? "BLOCKED · NOT CHARGED" : "RELEASED · NOT CHARGED", charged: false, tone: "warn" };
    case "FAILED":
      return { label: "FAILED · NOT CHARGED", charged: false, tone: "bad" };
    case "UNKNOWN":
      return { label: "UNKNOWN · RECONCILING", charged: false, tone: "warn" };
    default:
      return { label: `${p.status} · PENDING`, charged: false, tone: "violet" };
  }
}
