import { z } from "zod";
import { env } from "./env";
import { CAPABILITIES, eligibleWorkersFor, type Capability } from "./registry";

/** What the LLM is allowed to propose. Everything else is decided by deterministic code. */
export const ProposedTaskSchema = z.object({
  taskId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,31}$/, "taskId must be kebab-case, 2-32 chars"),
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(600),
  dependencies: z.array(z.string()).max(5),
  capability: z.enum(CAPABILITIES as [Capability, ...Capability[]]),
  estimatedCostUsdc: z.number().min(0).max(1),
  maxCostUsdc: z.number().min(0).max(1),
  retryLimit: z.number().int().min(0).max(3),
  timeoutSec: z.number().int().min(10).max(300),
  verificationCriteria: z.array(z.string().min(3).max(200)).min(1).max(6),
});
export const ProposedPlanSchema = z.object({
  summary: z.string().min(5).max(400),
  tasks: z.array(ProposedTaskSchema).min(2).max(6),
});
export type ProposedPlan = z.infer<typeof ProposedPlanSchema>;

export interface PlannedTask {
  taskId: string;
  title: string;
  description: string;
  dependencies: string[];
  capability: Capability;
  eligibleWorkers: string[];
  backupWorkers: string[];
  estimatedCost: { usdc: number; mon: number };
  maxCost: { usdc: number; mon: number };
  retryLimit: number;
  timeoutMs: number;
  verificationCriteria: string[];
  status: "CREATED";
}
export interface Plan {
  summary: string;
  tasks: PlannedTask[];
  totalEstimatedUsdc: number;
}

export interface BudgetInput {
  x402Usdc: number; // total x402 spend cap (USDC)
  perCallUsdc: number; // per-purchase cap (USDC)
  approvalThresholdUsdc: number; // purchases above this need explicit approval
  escrowMon: number; // MON locked in TaskEscrow for the deliverable
  gasMon: number; // gas allowance (MON)
}

export class PlanValidationError extends Error {
  constructor(public issues: string[]) {
    super(`plan rejected: ${issues.join("; ")}`);
  }
}

/** Deterministic validation of an untrusted (LLM or rule-based) plan. */
export function validatePlan(raw: unknown, budget: BudgetInput): Plan {
  const parsed = ProposedPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlanValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const p = parsed.data;
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const t of p.tasks) {
    if (ids.has(t.taskId)) issues.push(`duplicate taskId ${t.taskId}`);
    ids.add(t.taskId);
  }
  for (const t of p.tasks) {
    for (const d of t.dependencies) {
      if (!ids.has(d)) issues.push(`${t.taskId} depends on unknown task ${d}`);
      if (d === t.taskId) issues.push(`${t.taskId} depends on itself`);
    }
    if (t.estimatedCostUsdc > t.maxCostUsdc) issues.push(`${t.taskId} estimatedCost > maxCost`);
    if (t.maxCostUsdc > budget.perCallUsdc * 3) issues.push(`${t.taskId} maxCost exceeds per-task bound`);
    if (t.capability !== "research" && t.estimatedCostUsdc > 0)
      issues.push(`${t.taskId}: only research tasks may purchase paid data`);
  }
  if (hasCycle(p.tasks)) issues.push("dependency graph contains a cycle");

  const caps = p.tasks.map((t) => t.capability);
  for (const c of CAPABILITIES) if (!caps.includes(c)) issues.push(`plan must include a ${c} task`);
  const synth = p.tasks.filter((t) => t.capability === "synthesis");
  if (synth.length !== 1) issues.push("plan must have exactly one synthesis task");
  else {
    const reach = ancestors(p.tasks, synth[0].taskId);
    for (const t of p.tasks)
      if (t.taskId !== synth[0].taskId && !reach.has(t.taskId))
        issues.push(`synthesis must (transitively) depend on ${t.taskId}`);
  }
  for (const t of p.tasks.filter((t) => t.capability === "analysis")) {
    const reach = ancestors(p.tasks, t.taskId);
    if (!p.tasks.some((r) => r.capability === "research" && reach.has(r.taskId)))
      issues.push(`analysis task ${t.taskId} must depend on a research task`);
  }

  const total = round6(p.tasks.reduce((s, t) => s + t.estimatedCostUsdc, 0));
  if (total > budget.x402Usdc) issues.push(`estimated x402 cost ${total} USDC exceeds budget ${budget.x402Usdc} USDC`);
  if (issues.length) throw new PlanValidationError(issues);

  const monPerTask = budget.escrowMon; // escrow is attached to the synthesis deliverable only
  return {
    summary: p.summary,
    totalEstimatedUsdc: total,
    tasks: p.tasks.map((t) => {
      const ew = eligibleWorkersFor(t.capability);
      return {
        taskId: t.taskId,
        title: t.title,
        description: t.description,
        dependencies: t.dependencies,
        capability: t.capability,
        eligibleWorkers: ew.primary,
        backupWorkers: ew.backup,
        estimatedCost: { usdc: t.estimatedCostUsdc, mon: t.capability === "synthesis" ? monPerTask : 0 },
        maxCost: { usdc: t.maxCostUsdc, mon: t.capability === "synthesis" ? monPerTask : 0 },
        retryLimit: t.retryLimit,
        timeoutMs: t.timeoutSec * 1000,
        verificationCriteria: t.verificationCriteria,
        status: "CREATED" as const,
      };
    }),
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function hasCycle(tasks: { taskId: string; dependencies: string[] }[]): boolean {
  const deps = new Map(tasks.map((t) => [t.taskId, t.dependencies]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return tasks.some((t) => visit(t.taskId));
}

function ancestors(tasks: { taskId: string; dependencies: string[] }[], id: string): Set<string> {
  const deps = new Map(tasks.map((t) => [t.taskId, t.dependencies]));
  const out = new Set<string>();
  const stack = [...(deps.get(id) ?? [])];
  while (stack.length) {
    const d = stack.pop()!;
    if (out.has(d)) continue;
    out.add(d);
    stack.push(...(deps.get(d) ?? []));
  }
  return out;
}

/** Rule-based planner used when no LLM key is configured (labelled as such everywhere). */
export function ruleBasedPlan(goal: string, budget: BudgetInput): ProposedPlan {
  const datasetPrice = 0.01;
  return {
    summary: `Three-stage research pipeline for: "${goal.slice(0, 200)}"`,
    tasks: [
      {
        taskId: "research",
        title: "Gather Monad ecosystem evidence",
        description:
          "Purchase the Monad ecosystem dataset through x402, then collect allowlisted public sources (Monad docs, Monad GitHub org) and extract structured, cited facts.",
        dependencies: [],
        capability: "research",
        estimatedCostUsdc: Math.min(datasetPrice, budget.perCallUsdc),
        maxCostUsdc: Math.min(budget.perCallUsdc, budget.x402Usdc),
        retryLimit: 2,
        timeoutSec: 120,
        verificationCriteria: [
          "at least 3 sources with URLs",
          "paid dataset receipt recorded or purchase explicitly blocked",
          "facts reference a source id",
        ],
      },
      {
        taskId: "analysis",
        title: "Analyze ecosystem signals",
        description:
          "Rank protocols and developer activity, identify technical opportunities and risks, and tie every insight to source evidence.",
        dependencies: ["research"],
        capability: "analysis",
        estimatedCostUsdc: 0,
        maxCostUsdc: 0,
        retryLimit: 2,
        timeoutSec: 90,
        verificationCriteria: ["at least 3 insights", "every insight cites evidence", "risks section present"],
      },
      {
        taskId: "briefing",
        title: "Synthesize technical briefing",
        description:
          "Write an actionable technical briefing in Markdown with recommendations, cited sources and clearly marked unverified claims.",
        dependencies: ["analysis"],
        capability: "synthesis",
        estimatedCostUsdc: 0,
        maxCostUsdc: 0,
        retryLimit: 1,
        timeoutSec: 90,
        verificationCriteria: [
          "markdown has Executive Summary, Recommendations and Sources sections",
          "at least 3 source links",
          "result hash matches stored artifact",
        ],
      },
    ],
  };
}

const PLANNER_SYSTEM = `You are the SYNAPSE planner. Convert the user's research goal into a small DAG of tasks.
Return ONLY JSON: {"summary": string, "tasks": [{"taskId": kebab-case, "title", "description", "dependencies": [taskId], "capability": "research"|"analysis"|"synthesis", "estimatedCostUsdc": number, "maxCostUsdc": number, "retryLimit": 0-3, "timeoutSec": 10-300, "verificationCriteria": [string]}]}
Rules: 3-5 tasks. Exactly one "synthesis" task that depends (transitively) on all others. Every analysis task depends on a research task.
Only research tasks may have non-zero cost (they buy a paid dataset at ~0.01 USDC via x402). Total estimated cost must not exceed the budget.
You cannot choose workers, URLs, wallets, or payment recipients; those are assigned by deterministic code.`;

export async function llmChat(system: string, user: string, json = true): Promise<string> {
  const e = env();
  const res = await fetch(`${e.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${e.LLM_API_KEY}` },
    body: JSON.stringify({
      model: e.LLM_MODEL,
      temperature: 0.3,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content;
}

export function llmConfigured() {
  return Boolean(env().LLM_API_KEY);
}

export async function generatePlan(
  goal: string,
  budget: BudgetInput,
): Promise<{ plan: Plan; planner: string; notes: string[] }> {
  const notes: string[] = [];
  if (llmConfigured()) {
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await llmChat(
          PLANNER_SYSTEM,
          `Goal: ${goal}\nBudget: x402 total ${budget.x402Usdc} USDC, per call ${budget.perCallUsdc} USDC.${feedback}`,
        );
        const plan = validatePlan(JSON.parse(out), budget);
        return { plan, planner: `llm:${env().LLM_MODEL}`, notes };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notes.push(`LLM plan attempt ${attempt} rejected: ${msg.slice(0, 300)}`);
        feedback = `\nYour previous plan was rejected: ${msg.slice(0, 500)}. Fix it.`;
      }
    }
    notes.push("Falling back to rule-based planner after LLM plans failed validation.");
  } else {
    notes.push("No LLM_API_KEY configured: using deterministic rule-based planner.");
  }
  return { plan: validatePlan(ruleBasedPlan(goal, budget), budget), planner: "rule-based", notes };
}
