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

const PLANNER_SYSTEM = `You are the SYNAPSE planner. Synapse runs research workflows about the Monad blockchain ecosystem using three capabilities:
- "research": buys a Monad ecosystem dataset (~0.01 USDC via x402) and reads allowlisted public sources (Monad docs, Monad GitHub, Monad testnet RPC)
- "analysis": turns research facts into cited insights and risks
- "synthesis": writes one cited Markdown briefing
Convert the user's goal into a small DAG of tasks whose titles and descriptions are specific to that goal.
If the goal is NOT a research/analysis/briefing request about Monad or its ecosystem (for example moving funds, deploying contracts, trading, executing code, or an unrelated topic), return ONLY {"unsupported": true, "reason": "<one sentence>"}.
Otherwise return ONLY JSON: {"summary": string, "tasks": [{"taskId": kebab-case, "title", "description", "dependencies": [taskId], "capability": "research"|"analysis"|"synthesis", "estimatedCostUsdc": number, "maxCostUsdc": number, "retryLimit": 0-3, "timeoutSec": 10-300, "verificationCriteria": [string]}]}
Rules: 3-5 tasks. Exactly one "synthesis" task that depends (transitively) on all others. Every analysis task depends on a research task.
Only research tasks may have non-zero cost. Total estimated cost must not exceed the budget; maxCostUsdc must not exceed the per-call cap.
You cannot choose workers, URLs, wallets, or payment recipients; those are assigned by deterministic code.`;

/** Human-facing provider name derived from the OpenAI-compatible base URL. */
export function llmProvider(): { id: string; name: string; model: string } {
  const e = env();
  let host = "";
  try {
    host = new URL(e.LLM_BASE_URL).hostname;
  } catch {
    host = e.LLM_BASE_URL;
  }
  const known: [RegExp, string, string][] = [
    [/(^|\.)groq\.com$/, "groq", "Groq"],
    [/(^|\.)openai\.com$/, "openai", "OpenAI"],
    [/(^|\.)openrouter\.ai$/, "openrouter", "OpenRouter"],
    [/(^|\.)together\.(ai|xyz)$/, "together", "Together"],
  ];
  const k = known.find(([re]) => re.test(host));
  return { id: k?.[1] ?? host, name: k?.[2] ?? host, model: e.LLM_MODEL };
}

/** Provider/transport failure. Messages never include the API key. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfter?: string | null,
  ) {
    super(message);
  }
}
/** Goal is outside what Synapse workers can execute (HTTP 422, nothing saved). */
export class UnsupportedGoalError extends Error {}

export interface LlmResult {
  content: string;
  responseId: string | null;
  model: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  latencyMs: number;
}

export async function llmChatDetailed(system: string, user: string, json = true): Promise<LlmResult> {
  const e = env();
  const p = llmProvider();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${e.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${e.LLM_API_KEY}` },
      body: JSON.stringify({
        model: e.LLM_MODEL,
        temperature: 0.3,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...(e.LLM_REASONING_EFFORT ? { reasoning_effort: e.LLM_REASONING_EFFORT } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    throw new LlmProviderError(`${p.name} request failed: ${timedOut ? "timed out after 60s" : (err as Error).message}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      detail = j.error?.message ?? j.error?.code ?? "";
    } catch {
      detail = "";
    }
    const hint =
      res.status === 429
        ? " (rate limited: wait and retry)"
        : res.status === 401 || res.status === 403
          ? " (check LLM_API_KEY)"
          : res.status === 404
            ? ` (model "${e.LLM_MODEL}" not available to this key; list models at ${e.LLM_BASE_URL}/models)`
            : "";
    throw new LlmProviderError(
      `${p.name} HTTP ${res.status}${hint}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
      res.headers.get("retry-after"),
    );
  }
  const j = (await res.json()) as {
    id?: string;
    model?: string;
    usage?: LlmResult["usage"];
    choices?: { message?: { content?: string } }[];
  };
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new LlmProviderError(`${p.name} returned an empty completion`);
  return { content, responseId: j.id ?? null, model: j.model ?? null, usage: j.usage ?? null, latencyMs: Date.now() - started };
}

export async function llmChat(system: string, user: string, json = true): Promise<string> {
  return (await llmChatDetailed(system, user, json)).content;
}

export function llmConfigured() {
  return Boolean(env().LLM_API_KEY);
}

/** Deterministic pre-check: Synapse only researches and writes briefings; it never performs requested actions. */
const ACTION_PATTERNS: [RegExp, string][] = [
  [/\b(send|transfer|withdraw|bridge|swap|trade|stake|unstake)\b.*\b(mon|usdc|eth|tokens?|funds|money|crypto)\b/i, "moving or trading funds"],
  [/\b(private key|seed phrase|mnemonic)\b/i, "handling wallet secrets"],
  [/\b(deploy|mint|airdrop)\b/i, "deploying or minting on-chain"],
  [/\b(run|execute)\b.*\b(shell|command|script|code)\b/i, "executing code"],
];
export function assertSupportedGoal(goal: string) {
  for (const [re, what] of ACTION_PATTERNS)
    if (re.test(goal))
      throw new UnsupportedGoalError(
        `Unsupported goal: Synapse workers only research and write cited briefings; they cannot perform ${what}. Rephrase it as a research question, e.g. "Analyze ...".`,
      );
}

export interface PlanSource {
  kind: "llm" | "rule-based";
  provider: string | null;
  model: string | null;
  responseId: string | null;
  usage: LlmResult["usage"];
  latencyMs: number | null;
  attempts: number;
  fallbackReason: string | null;
}

export async function generatePlan(
  goal: string,
  budget: BudgetInput,
): Promise<{ plan: Plan; planner: string; notes: string[]; source: PlanSource }> {
  assertSupportedGoal(goal);
  const notes: string[] = [];
  let fallbackReason: string | null = null;
  let attempts = 0;
  if (llmConfigured()) {
    const p = llmProvider();
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      let r: LlmResult;
      try {
        r = await llmChatDetailed(
          PLANNER_SYSTEM,
          `Goal: ${goal}\nBudget: x402 total ${budget.x402Usdc} USDC, per call ${budget.perCallUsdc} USDC.${feedback}`,
        );
      } catch (err) {
        // Provider errors (429, auth, timeouts) are not retried here, to avoid amplifying rate limits.
        fallbackReason = (err as Error).message;
        notes.push(`${p.name} unavailable: ${fallbackReason}`);
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.content);
      } catch {
        fallbackReason = `${p.name} returned invalid JSON`;
        notes.push(`${p.name} attempt ${attempt}: output was not valid JSON`);
        feedback = "\nYour previous output was not valid JSON. Return ONLY the JSON object.";
        continue;
      }
      const maybe = parsed as { unsupported?: boolean; reason?: string };
      if (maybe?.unsupported === true) {
        throw new UnsupportedGoalError(
          `Unsupported goal: ${String(maybe.reason ?? "outside Synapse's Monad research capabilities").slice(0, 240)} Synapse plans research, analysis and briefings about the Monad ecosystem.`,
        );
      }
      try {
        const plan = validatePlan(parsed, budget);
        const model = r.model ?? p.model;
        return {
          plan,
          planner: `${p.id}:${model}`,
          notes,
          source: { kind: "llm", provider: p.name, model, responseId: r.responseId, usage: r.usage, latencyMs: r.latencyMs, attempts: attempt, fallbackReason: null },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fallbackReason = `${p.name} output failed DAG validation`;
        notes.push(`${p.name} plan attempt ${attempt} rejected by validator: ${msg.slice(0, 300)}`);
        feedback = `\nYour previous plan was rejected: ${msg.slice(0, 500)}. Fix it.`;
      }
    }
    notes.push(`Used the deterministic rule-based planner instead (${fallbackReason}).`);
  } else {
    fallbackReason = "no LLM_API_KEY configured";
    notes.push("No LLM_API_KEY configured: using deterministic rule-based planner.");
  }
  return {
    plan: validatePlan(ruleBasedPlan(goal, budget), budget),
    planner: "rule-based",
    notes,
    source: { kind: "rule-based", provider: null, model: null, responseId: null, usage: null, latencyMs: null, attempts, fallbackReason },
  };
}
