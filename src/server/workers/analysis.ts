import { z } from "zod";
import { sleep } from "../core";
import { env } from "../env";
import { llmChat, llmConfigured } from "../planner";
import type { TaskContext } from "../runtime";
import type { Fact, Source } from "./research";

/** Analysis capability (Worker B). Turns cited research facts into ranked, evidence-linked insights. */

export interface Insight {
  id: string;
  title: string;
  detail: string;
  evidence: string[]; // fact ids
  kind: "opportunity" | "trend" | "risk" | "developer";
  confidence: "sourced" | "derived";
}

interface ResearchOutput {
  sources: Source[];
  facts: Fact[];
  dataset: { status: string; reason?: string; paymentId?: string; txHash?: string | null };
  premiumProbe: { status: string; reason?: string } | null;
  topProtocols: { name: string; category: string; monadTvlUsd: number; url: string }[];
  tvlHistory30d: { date: string; tvlUsd: number }[];
  githubRepos: { name: string; url: string; stars: number; pushedAt: string; description: string | null }[];
  network: { avgBlockTimeMs: number; gasPriceGwei: string } | null;
}

const LlmInsights = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().min(5).max(120),
        detail: z.string().min(20).max(600),
        evidence: z.array(z.string()).min(1).max(6),
        kind: z.enum(["opportunity", "trend", "risk", "developer"]),
      }),
    )
    .min(3)
    .max(8),
  risks: z.array(z.string().min(10).max(300)).min(1).max(5),
});

function mergeResearch(deps: Record<string, unknown>): ResearchOutput {
  const outs = Object.values(deps) as ResearchOutput[];
  const research = outs.filter((o) => Array.isArray(o?.facts));
  if (!research.length) throw new Error("analysis requires at least one research output");
  // Multiple research tasks: merge (fact ids are namespaced per task to stay unique).
  if (research.length === 1) return research[0];
  const merged: ResearchOutput = { ...research[0], sources: [], facts: [] };
  research.forEach((r, i) => {
    merged.sources.push(...r.sources.filter((s) => !merged.sources.some((m) => m.id === s.id)));
    merged.facts.push(...r.facts.map((f) => ({ ...f, id: `R${i + 1}.${f.id}` })));
  });
  return merged;
}

export function deterministicInsights(r: ResearchOutput): { insights: Insight[]; risks: string[] } {
  const f = (pred: (x: Fact) => boolean) => r.facts.filter(pred).map((x) => x.id);
  const insights: Insight[] = [];
  const add = (i: Omit<Insight, "id">) => i.evidence.length && insights.push({ ...i, id: `I${insights.length + 1}` });

  const tvl = f((x) => x.sourceId === "defillama-chains");
  const trend = r.facts.find((x) => x.sourceId === "defillama-monad-history");
  if (tvl.length)
    add({
      kind: "trend",
      title: "Monad already carries meaningful DeFi liquidity",
      detail: `On-chain capital is present (${r.facts.find((x) => x.id === tvl[0])?.claim}). Builders can target existing liquidity rather than bootstrapping from zero.`,
      evidence: tvl,
      confidence: "sourced",
    });
  if (trend)
    add({
      kind: "trend",
      title: Number(trend.value) >= 0 ? "TVL momentum is positive over 30 days" : "TVL contracted over the last 30 days",
      detail: `${trend.claim}. ${Number(trend.value) >= 0 ? "Growth supports launching liquidity-dependent products now." : "Contraction argues for capital-efficient designs and incentive caution."}`,
      evidence: [trend.id],
      confidence: "derived",
    });
  const conc = r.facts.find((x) => /Top 3 protocols account/.test(x.claim));
  const tops = f((x) => /holds ~\$/.test(x.claim));
  if (conc || tops.length)
    add({
      kind: Number(conc?.value ?? 0) > 60 ? "risk" : "opportunity",
      title: Number(conc?.value ?? 0) > 60 ? "Liquidity is concentrated in a few protocols" : "Liquidity is spread across several protocols",
      detail: `${conc?.claim ?? "Top protocols identified"}. ${Number(conc?.value ?? 0) > 60 ? "Integrations with the leading venues are high-leverage; dependency risk is correspondingly high." : "Room exists for new entrants in under-served categories."}`,
      evidence: [...(conc ? [conc.id] : []), ...tops.slice(0, 3)],
      confidence: "derived",
    });
  const cats = r.facts.find((x) => /Most common Monad protocol categories/.test(x.claim));
  if (cats)
    add({
      kind: "opportunity",
      title: "Category gaps suggest where to build",
      detail: `${cats.claim}. Categories absent from this list (e.g. agent payments, data oracles, infra tooling) are candidate white space — validate with user interviews.`,
      evidence: [cats.id],
      confidence: "derived",
    });
  const net = f((x) => x.sourceId === "monad-testnet-rpc");
  if (net.length)
    add({
      kind: "developer",
      title: "Fast blocks enable interactive, high-frequency agent settlement",
      detail: `Live probe: ${r.facts.filter((x) => net.includes(x.id)).map((x) => x.claim).join("; ")}. Sub-second-to-second confirmation makes per-task escrow and micro-payments practical for agent workflows.`,
      evidence: net,
      confidence: "sourced",
    });
  const gh = f((x) => x.sourceId === "github-monad-developers");
  if (gh.length)
    add({
      kind: "developer",
      title: "Active first-party developer tooling",
      detail: `${r.facts.filter((x) => gh.includes(x.id)).map((x) => x.claim).join("; ")}. Track these repos for SDK and infra changes that affect integrations.`,
      evidence: gh,
      confidence: "sourced",
    });
  const docs = f((x) => x.sourceId === "monad-docs");
  if (docs.length)
    add({
      kind: "developer",
      title: "Documentation surface is broad",
      detail: `${r.facts.filter((x) => docs.includes(x.id)).map((x) => x.claim).join("; ")}. EVM-compatibility notes and performance docs are the first stop for porting existing contracts.`,
      evidence: docs,
      confidence: "sourced",
    });

  const risks: string[] = [];
  if (conc && Number(conc.value) > 60) risks.push(`Protocol concentration (${conc.value}% in top 3) creates single-venue dependency risk.`);
  if (trend && Number(trend.value) < 0) risks.push(`Negative 30-day TVL trend (${trend.value}%) — liquidity may be incentive-driven.`);
  if (r.dataset.status !== "PAID" && r.dataset.status !== "REUSED")
    risks.push(`Paid market dataset was not obtained (${r.dataset.status}: ${r.dataset.reason ?? "n/a"}); market claims rely on free sources only.`);
  risks.push("TVL figures are third-party (DefiLlama) aggregates and are not independently audited by Synapse.");
  risks.push("Testnet performance observations do not guarantee mainnet behaviour under load.");
  return { insights, risks };
}

export async function analysisHandler(ctx: TaskContext): Promise<unknown> {
  const research = mergeResearch(ctx.dependencyOutputs());
  const knownFactIds = research.facts.map((f) => f.id);
  const done = new Set(ctx.resumedFrom?.completedSteps ?? []);
  let state = (ctx.resumedFrom?.state ?? {}) as { insights?: Insight[]; risks?: string[]; method?: string; llmNote?: string };

  if (!done.has("analyze")) {
    ctx.setStep("analyze");
    await sleep(env().DEMO_STEP_DELAY_MS);
    let method = "deterministic-rules";
    let result = deterministicInsights(research);
    let llmNote: string | undefined;
    if (llmConfigured()) {
      try {
        const raw = await llmChat(
          "You are a blockchain ecosystem analyst. Use ONLY the provided facts. Every insight's evidence must be a list of fact ids from the input. Return JSON {insights:[{title,detail,evidence,kind}], risks:[string]}.",
          JSON.stringify({ goal: ctx.goal, facts: research.facts }),
        );
        const parsed = LlmInsights.parse(JSON.parse(raw));
        const ok = parsed.insights.every((i) => i.evidence.every((e) => knownFactIds.includes(e)));
        if (!ok) throw new Error("LLM cited unknown fact ids");
        result = {
          insights: parsed.insights.map((i, k) => ({ ...i, id: `I${k + 1}`, confidence: "derived" as const })),
          risks: parsed.risks,
        };
        method = `llm:${env().LLM_MODEL}`;
      } catch (err) {
        llmNote = `LLM analysis rejected (${(err as Error).message.slice(0, 160)}); used deterministic rules`;
        ctx.emit("worker.step", llmNote, undefined, "warn");
      }
    }
    state = { ...result, method, llmNote };
    done.add("analyze");
    ctx.saveCheckpoint({ completedSteps: [...done], state, artifactIds: [], paymentOpIds: [] });
  }
  ctx.setStep("package");
  return {
    method: state.method,
    note: state.llmNote ?? null,
    insights: state.insights,
    risks: state.risks,
    knownFactIds,
    facts: research.facts,
    sources: research.sources,
    dataset: research.dataset,
    premiumProbe: research.premiumProbe,
    topProtocols: research.topProtocols,
    githubRepos: research.githubRepos,
    network: research.network,
  };
}
