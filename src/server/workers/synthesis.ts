import { sleep } from "../core";
import { env } from "../env";
import type { TaskContext } from "../runtime";
import type { Insight } from "./analysis";
import type { Fact, Source } from "./research";

/** Synthesis capability (Worker B): renders the cited Markdown briefing. */

interface AnalysisOutput {
  method: string;
  insights: Insight[];
  risks: string[];
  facts: Fact[];
  sources: Source[];
  dataset: { status: string; reason?: string; paymentId?: string; txHash?: string | null };
  premiumProbe: { status: string; reason?: string } | null;
  topProtocols: { name: string; category: string; monadTvlUsd: number; url: string }[];
  githubRepos: { name: string; url: string; stars: number; pushedAt: string; description: string | null }[];
}

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("en-US")}`);

export function renderBriefing(goal: string, workflowId: string, a: AnalysisOutput, generatedAt = new Date().toISOString()) {
  const src = new Map(a.sources.map((s) => [s.id, s]));
  const factById = new Map(a.facts.map((f) => [f.id, f]));
  const cite = (ids: string[]) =>
    [...new Set(ids.map((id) => factById.get(id)?.sourceId).filter(Boolean) as string[])]
      .map((sid) => `[${sid}](${src.get(sid)?.url ?? "#"})`)
      .join(", ");
  const opp = a.insights.filter((i) => i.kind !== "risk");
  const L: string[] = [];
  L.push(`# Monad Ecosystem — Technical Briefing`);
  L.push("");
  L.push(`> Goal: ${goal}`);
  L.push(`> Workflow \`${workflowId}\` · generated ${generatedAt} · analysis method: \`${a.method}\``);
  L.push("");
  L.push(`## Executive Summary`);
  L.push("");
  const head = a.insights.slice(0, 3).map((i) => `**${i.title}.** ${i.detail.split(". ")[0]}.`);
  L.push(head.join(" "));
  L.push("");
  L.push(
    `This briefing is built from ${a.sources.length} sources and ${a.facts.length} extracted facts. Every insight below links to the facts it relies on; claims marked _derived_ are Synapse interpretations, not source statements.`,
  );
  L.push("");
  L.push(`## Key Metrics`);
  L.push("");
  L.push(`| # | Fact | Source |`);
  L.push(`|---|------|--------|`);
  for (const f of a.facts) L.push(`| ${f.id} | ${f.claim.replace(/\|/g, "/")} | [${f.sourceId}](${src.get(f.sourceId)?.url ?? "#"}) |`);
  L.push("");
  if (a.topProtocols.length) {
    L.push(`### Top protocols by Monad TVL`);
    L.push("");
    L.push(`| Protocol | Category | Monad TVL |`);
    L.push(`|---|---|---|`);
    for (const p of a.topProtocols.slice(0, 8)) L.push(`| [${p.name}](${p.url}) | ${p.category} | ${usd(p.monadTvlUsd)} |`);
    L.push("");
  }
  L.push(`## Insights`);
  L.push("");
  for (const i of a.insights) {
    L.push(`### ${i.id}. ${i.title}`);
    L.push(`_${i.kind} · ${i.confidence}_ — evidence: ${i.evidence.join(", ")} (${cite(i.evidence)})`);
    L.push("");
    L.push(i.detail);
    L.push("");
  }
  L.push(`## Recommendations`);
  L.push("");
  const recs: string[] = [];
  for (const i of opp.slice(0, 5)) {
    if (i.kind === "developer") recs.push(`**Build on the developer surface:** ${i.title.toLowerCase()} — prioritise integrations that exploit this (${i.evidence.join(", ")}).`);
    else if (i.kind === "opportunity") recs.push(`**Pursue:** ${i.title} — validate demand before committing capital (${i.evidence.join(", ")}).`);
    else recs.push(`**Monitor:** ${i.title} — re-run this workflow weekly to track the trend (${i.evidence.join(", ")}).`);
  }
  recs.push(`**Settle agent work on-chain:** use per-task escrow (as this workflow did) for outcome-dependent payouts, and x402 for metered data purchases with hard per-call caps.`);
  recs.forEach((r, k) => L.push(`${k + 1}. ${r}`));
  L.push("");
  L.push(`## Risks & Caveats`);
  L.push("");
  for (const r of a.risks) L.push(`- ${r}`);
  L.push("");
  L.push(`## Unverified / Derived Claims`);
  L.push("");
  const derived = a.insights.filter((i) => i.confidence === "derived");
  if (derived.length) for (const d of derived) L.push(`- ${d.id} "${d.title}" is an interpretation of ${d.evidence.join(", ")}; it is not stated by any source.`);
  else L.push(`- None: all insights restate sourced facts.`);
  L.push(`- Synapse verified structure, citations and hashes deterministically; it did not independently audit third-party metrics.`);
  L.push("");
  L.push(`## Data Provenance`);
  L.push("");
  L.push(
    `- Paid dataset: **${a.dataset.status}**${a.dataset.txHash ? ` — x402 settlement tx \`${a.dataset.txHash}\` ([explorer](${env().MONAD_TESTNET_EXPLORER_URL}/tx/${a.dataset.txHash}))` : ""}${a.dataset.reason ? ` — ${a.dataset.reason}` : ""}`,
  );
  if (a.premiumProbe) L.push(`- Premium deep-dive request: **${a.premiumProbe.status}**${a.premiumProbe.reason ? ` — ${a.premiumProbe.reason}` : ""}`);
  L.push("");
  L.push(`## Sources`);
  L.push("");
  for (const s of a.sources) L.push(`- **${s.id}** — [${s.title}](${s.url}) (${s.kind}, retrieved ${s.retrievedAt})`);
  L.push("");
  return L.join("\n");
}

export async function synthesisHandler(ctx: TaskContext): Promise<unknown> {
  const deps = ctx.dependencyOutputs();
  const analysis = Object.values(deps).find((d) => Array.isArray((d as AnalysisOutput)?.insights)) as AnalysisOutput | undefined;
  if (!analysis) throw new Error("synthesis requires an analysis output");
  ctx.setStep("render");
  await sleep(env().DEMO_STEP_DELAY_MS);
  const markdown = renderBriefing(ctx.goal, ctx.workflowId, analysis);
  ctx.saveCheckpoint({ completedSteps: ["render"], state: { chars: markdown.length }, artifactIds: [], paymentOpIds: [] });
  return {
    title: "Monad Ecosystem — Technical Briefing",
    markdown,
    sources: analysis.sources,
    insightCount: analysis.insights.length,
    factCount: analysis.facts.length,
  };
}
