import { toBaseUnits, sleep } from "../core";
import { env, USDC_DECIMALS } from "../env";
import { RetryableError, type TaskContext } from "../runtime";
import { purchase } from "../x402pay";
import { publicClient } from "../chain";

/**
 * Research capability. Primary implementation runs on Worker A.
 * Worker B is registered as a checkpoint-resume backup and executes the remaining steps of the
 * SAME persisted plan — completed steps (including the paid x402 purchase) are never repeated.
 */

export interface Source {
  id: string;
  title: string;
  url: string;
  kind: "paid-dataset" | "docs" | "github" | "api";
  retrievedAt: string;
}
export interface Fact {
  id: string;
  claim: string;
  sourceId: string;
  value?: string | number;
}
export interface ResearchState {
  dataset?: { status: string; paymentId?: string; artifactId?: string; txHash?: string | null; reason?: string; data?: DatasetShape };
  premium?: { status: string; reason?: string; paymentId?: string };
  docs?: { sections: { title: string; url: string }[]; source: Source };
  github?: { repos: { name: string; url: string; stars: number; pushedAt: string; description: string | null; language: string | null }[]; source: Source };
  network?: { chainId: number; blockNumber: string; gasPriceGwei: string; avgBlockTimeMs: number; sampleBlocks: number; source: Source };
  facts?: Fact[];
}

interface DatasetShape {
  generatedAt: string;
  sources: { id: string; url: string; title: string }[];
  chain: { name: string; chainId: number; token: string; tvlUsd: number; tvlRank: number } | null;
  tvlHistory30d: { date: string; tvlUsd: number }[];
  protocolCount: number;
  categories: Record<string, number>;
  topProtocols: { name: string; category: string; monadTvlUsd: number; url: string; defillama: string }[];
}

const STEPS = ["purchase_dataset", "policy_probe_premium", "monad_docs", "github_activity", "network_probe", "extract_facts"] as const;

async function getText(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "synapse-research-worker/0.1", accept: "*/*" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new RetryableError(`${url} -> HTTP ${r.status}`);
  return r.text();
}

export async function researchHandler(ctx: TaskContext): Promise<unknown> {
  const done = new Set<string>(ctx.resumedFrom?.completedSteps ?? []);
  const state: ResearchState = (ctx.resumedFrom?.state as ResearchState) ?? {};
  const artifactIds = new Set<string>(ctx.resumedFrom?.artifactIds ?? []);
  const paymentOpIds = new Set<string>(ctx.resumedFrom?.paymentOpIds ?? []);
  const delay = env().DEMO_STEP_DELAY_MS;
  const maxCost = JSON.parse(ctx.task.max_cost_json) as { usdc: number };
  const taskMaxBase = toBaseUnits(String(maxCost.usdc), USDC_DECIMALS);
  const checkpoint = (step: string) => {
    done.add(step);
    ctx.saveCheckpoint({ completedSteps: [...done], state: state as Record<string, unknown>, artifactIds: [...artifactIds], paymentOpIds: [...paymentOpIds] });
  };
  if (done.size) ctx.emit("worker.resume", `Resuming research; skipping ${done.size} completed step(s): ${[...done].join(", ")}`, undefined, "success");

  for (const step of STEPS) {
    if (done.has(step)) continue;
    ctx.setStep(step);
    await sleep(delay);

    if (step === "purchase_dataset") {
      ctx.emit("worker.step", "Requesting paid Monad ecosystem dataset (x402)");
      const r = await purchase({
        workflowId: ctx.workflowId,
        taskId: ctx.task.task_id,
        workerId: ctx.workerId,
        providerId: "synapse-data",
        path: "/v1/monad/ecosystem",
        idempotencyKey: `${ctx.workflowId}:dataset:monad-ecosystem`,
        taskMaxUsdcBase: taskMaxBase,
      });
      if (r.status === "PAID" || r.status === "REUSED") {
        paymentOpIds.add(r.op.id);
        artifactIds.add(r.artifactId);
        state.dataset = { status: r.status, paymentId: r.op.id, artifactId: r.artifactId, txHash: r.op.tx_hash, data: r.data as DatasetShape };
      } else if (r.status === "UNKNOWN") {
        // Never proceed (or re-pay) while a payment outcome is unknown.
        throw new RetryableError(`payment outcome unknown: ${r.reason}`);
      } else {
        const reason = r.reason;
        if ("op" in r && r.op) paymentOpIds.add(r.op.id);
        state.dataset = { status: r.status, reason, paymentId: "op" in r ? r.op?.id : undefined };
        ctx.emit("worker.step", `Paid dataset unavailable (${r.status}): ${reason}. Continuing with public sources only.`, undefined, "warn");
      }
    }

    if (step === "policy_probe_premium") {
      // The agent "wants" a premium deep-dive; the deterministic policy guard must refuse it pre-payment.
      ctx.emit("worker.step", "Agent requests premium deep-dive (priced above per-call cap) — policy check");
      const r = await purchase({
        workflowId: ctx.workflowId,
        taskId: ctx.task.task_id,
        workerId: ctx.workerId,
        providerId: "synapse-data",
        path: "/v1/monad/deep-dive",
        idempotencyKey: `${ctx.workflowId}:dataset:monad-deep-dive`,
        taskMaxUsdcBase: taskMaxBase,
      });
      if (r.status === "PAID" || r.status === "REUSED") {
        paymentOpIds.add(r.op.id);
        state.premium = { status: r.status, paymentId: r.op.id };
      } else if (r.status === "UNKNOWN") {
        throw new RetryableError(`payment outcome unknown: ${r.reason}`);
      } else {
        state.premium = { status: r.status, reason: r.reason, paymentId: "op" in r ? r.op?.id : undefined };
      }
    }

    if (step === "monad_docs") {
      const url = "https://docs.monad.xyz/llms.txt";
      ctx.emit("worker.step", `Fetching allowlisted source ${url}`);
      const txt = await getText(url);
      const sections = [...txt.matchAll(/\[([^\]]{3,120})\]\((https:\/\/docs\.monad\.xyz[^)\s]*)\)/g)].map((m) => ({ title: m[1], url: m[2] }));
      state.docs = {
        sections: sections.slice(0, 200),
        source: { id: "monad-docs", title: "Monad Documentation (llms.txt index)", url, kind: "docs", retrievedAt: new Date().toISOString() },
      };
    }

    if (step === "github_activity") {
      const url = "https://api.github.com/orgs/monad-developers/repos?sort=pushed&per_page=30";
      ctx.emit("worker.step", `Fetching allowlisted source ${url}`);
      const repos = JSON.parse(await getText(url)) as { name: string; html_url: string; stargazers_count: number; pushed_at: string; description: string | null; language: string | null; archived: boolean }[];
      state.github = {
        repos: repos
          .filter((r) => !r.archived)
          .map((r) => ({ name: r.name, url: r.html_url, stars: r.stargazers_count, pushedAt: r.pushed_at, description: r.description, language: r.language })),
        source: { id: "github-monad-developers", title: "GitHub: monad-developers organization", url: "https://github.com/monad-developers", kind: "github", retrievedAt: new Date().toISOString() },
      };
    }

    if (step === "network_probe") {
      ctx.emit("worker.step", "Probing live Monad testnet RPC (chain id, head block, gas price, block cadence)");
      const pc = publicClient();
      const [chainId, head, gasPrice] = await Promise.all([pc.getChainId(), pc.getBlock(), pc.getGasPrice()]);
      const sample = 20n;
      const old = await pc.getBlock({ blockNumber: head.number - sample });
      const avgMs = Number((head.timestamp - old.timestamp) * 1000n) / Number(sample);
      state.network = {
        chainId,
        blockNumber: head.number.toString(),
        gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
        avgBlockTimeMs: Math.round(avgMs),
        sampleBlocks: Number(sample),
        source: { id: "monad-testnet-rpc", title: "Monad testnet JSON-RPC (live probe)", url: env().MONAD_RPC_URL, kind: "api", retrievedAt: new Date().toISOString() },
      };
    }

    if (step === "extract_facts") {
      state.facts = extractFacts(state);
      ctx.emit("worker.step", `Extracted ${state.facts.length} cited facts`);
    }
    checkpoint(step);
  }

  return buildOutput(state);
}

export function sourcesOf(state: ResearchState): Source[] {
  const out: Source[] = [];
  const ds = state.dataset?.data;
  if (ds) {
    out.push({ id: "x402-dataset", title: `Synapse Monad Data Service (paid via x402, ${state.dataset?.status})`, url: `${env().X402_SERVICE_URL}/v1/monad/ecosystem`, kind: "paid-dataset", retrievedAt: ds.generatedAt });
    for (const s of ds.sources) out.push({ id: s.id, title: s.title, url: s.url, kind: "api", retrievedAt: ds.generatedAt });
  }
  if (state.docs) out.push(state.docs.source);
  if (state.github) out.push(state.github.source);
  if (state.network) out.push(state.network.source);
  return out;
}

export function extractFacts(state: ResearchState): Fact[] {
  const facts: Fact[] = [];
  let n = 0;
  const add = (claim: string, sourceId: string, value?: string | number) => facts.push({ id: `F${++n}`, claim, sourceId, value });
  const ds = state.dataset?.data;
  if (ds?.chain) {
    add(`Monad mainnet (chainId ${ds.chain.chainId}) DeFi TVL is about $${(ds.chain.tvlUsd / 1e6).toFixed(1)}M`, "defillama-chains", ds.chain.tvlUsd);
    add(`Monad ranks #${ds.chain.tvlRank} among chains by DeFi TVL`, "defillama-chains", ds.chain.tvlRank);
  }
  if (ds && ds.tvlHistory30d.length > 1) {
    const a = ds.tvlHistory30d[0].tvlUsd;
    const b = ds.tvlHistory30d.at(-1)!.tvlUsd;
    const pct = a ? ((b - a) / a) * 100 : 0;
    add(`Monad TVL changed ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over the last ${ds.tvlHistory30d.length} days (${ds.tvlHistory30d[0].date} → ${ds.tvlHistory30d.at(-1)!.date})`, "defillama-monad-history", Number(pct.toFixed(2)));
  }
  if (ds) {
    add(`${ds.protocolCount} protocols list Monad deployments on DefiLlama`, "defillama-protocols", ds.protocolCount);
    const total = ds.topProtocols.reduce((s, p) => s + p.monadTvlUsd, 0);
    for (const p of ds.topProtocols.slice(0, 5)) add(`${p.name} (${p.category}) holds ~$${(p.monadTvlUsd / 1e6).toFixed(1)}M TVL on Monad`, "defillama-protocols", p.monadTvlUsd);
    if (ds.topProtocols.length >= 3 && total > 0) {
      const top3 = ds.topProtocols.slice(0, 3).reduce((s, p) => s + p.monadTvlUsd, 0);
      add(`Top 3 protocols account for ${((top3 / total) * 100).toFixed(0)}% of the top-15 protocol TVL on Monad`, "defillama-protocols", Number(((top3 / total) * 100).toFixed(1)));
    }
    const cats = Object.entries(ds.categories).sort((x, y) => y[1] - x[1]).slice(0, 4);
    if (cats.length) add(`Most common Monad protocol categories: ${cats.map(([c, k]) => `${c} (${k})`).join(", ")}`, "defillama-protocols");
  }
  if (state.docs) {
    const s = state.docs.sections;
    add(`Monad docs index lists ${s.length} pages`, "monad-docs", s.length);
    const topics = ["parallel", "MonadBFT", "async", "gas", "deferred", "RPC", "staking", "x402"];
    const covered = topics.filter((t) => s.some((x) => x.title.toLowerCase().includes(t.toLowerCase()) || x.url.toLowerCase().includes(t.toLowerCase())));
    if (covered.length) add(`Docs cover developer topics including: ${covered.join(", ")}`, "monad-docs");
  }
  if (state.github) {
    const r = state.github.repos;
    const cutoff = Date.now() - 30 * 86400_000;
    const active = r.filter((x) => Date.parse(x.pushedAt) > cutoff);
    add(`${active.length} of ${r.length} sampled monad-developers repos were pushed in the last 30 days`, "github-monad-developers", active.length);
    const top = [...r].sort((a, b) => b.stars - a.stars).slice(0, 3);
    if (top.length) add(`Most-starred monad-developers repos: ${top.map((x) => `${x.name} (${x.stars}★)`).join(", ")}`, "github-monad-developers");
  }
  if (state.network) {
    const nw = state.network;
    add(`Monad testnet (chainId ${nw.chainId}) head block ${nw.blockNumber} observed live`, "monad-testnet-rpc", nw.blockNumber);
    add(`Observed average block time ≈ ${nw.avgBlockTimeMs} ms over the last ${nw.sampleBlocks} testnet blocks (1 s timestamp resolution)`, "monad-testnet-rpc", nw.avgBlockTimeMs);
    add(`Testnet gas price ≈ ${nw.gasPriceGwei} gwei at probe time`, "monad-testnet-rpc", nw.gasPriceGwei);
  }
  return facts;
}

export function buildOutput(state: ResearchState) {
  const datasetMeta = { ...(state.dataset ?? { status: "MISSING" }) };
  delete datasetMeta.data;
  return {
    sources: sourcesOf(state),
    facts: state.facts ?? [],
    dataset: datasetMeta,
    premiumProbe: state.premium ?? null,
    docsSections: state.docs?.sections.slice(0, 40) ?? [],
    githubRepos: state.github?.repos.slice(0, 15) ?? [],
    network: state.network ?? null,
    tvlHistory30d: state.dataset?.data?.tvlHistory30d ?? [],
    topProtocols: state.dataset?.data?.topProtocols ?? [],
  };
}
