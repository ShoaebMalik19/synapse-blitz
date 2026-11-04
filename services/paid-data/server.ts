/**
 * Synapse Monad Data Service — an x402-gated HTTP API (separate process / provider identity).
 *
 * Unpaid requests receive HTTP 402 + PAYMENT-REQUIRED (x402 v2). Paid requests are verified and
 * settled by the configured facilitator on Monad testnet (eip155:10143, Circle testnet USDC,
 * `exact` scheme / EIP-3009). Data is fetched live from public sources and cached briefly.
 */
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const PORT = Number(process.env.X402_SERVICE_PORT ?? 4021);
const NETWORK = (process.env.X402_NETWORK_ID ?? "eip155:10143") as `${string}:${string}`;
const ASSET = process.env.X402_ASSET_ADDRESS ?? "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PAY_TO = process.env.X402_PAY_TO;
const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402-facilitator.molandak.org";
if (!PAY_TO) {
  console.error("[paid-data] X402_PAY_TO is required");
  process.exit(1);
}

// Prices in USDC base units (6 decimals).
export const PRICES = { ecosystem: "10000" /* 0.01 USDC */, deepDive: "250000" /* 0.25 USDC */ };

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());

const usdc = (amount: string) => ({ asset: ASSET, amount, extra: { name: "USDC", version: "2" } });

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "synapse-monad-data", network: NETWORK, asset: ASSET, payTo: PAY_TO, facilitator: FACILITATOR, prices: PRICES });
});

app.use(
  paymentMiddleware(
    {
      "GET /v1/monad/ecosystem": {
        accepts: [{ scheme: "exact", price: usdc(PRICES.ecosystem), network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 120 }],
        description: "Live Monad ecosystem dataset: chain TVL, 30d TVL history, top protocols (DefiLlama-derived)",
        mimeType: "application/json",
      },
      "GET /v1/monad/deep-dive": {
        accepts: [{ scheme: "exact", price: usdc(PRICES.deepDive), network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 120 }],
        description: "Premium deep-dive report (priced above Synapse default per-call cap)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

type Cache = { at: number; data: unknown };
let cache: Cache | null = null;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "user-agent": "synapse-data-service/0.1" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function buildDataset() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const chainsUrl = "https://api.llama.fi/v2/chains";
  const histUrl = "https://api.llama.fi/v2/historicalChainTvl/Monad";
  const protoUrl = "https://api.llama.fi/protocols";
  const [chains, hist, protocols] = await Promise.all([
    getJson<{ name: string; tvl: number; chainId: number | null; tokenSymbol: string }[]>(chainsUrl),
    getJson<{ date: number; tvl: number }[]>(histUrl),
    getJson<{ name: string; slug: string; category: string; chains: string[]; chainTvls: Record<string, number>; url: string }[]>(protoUrl),
  ]);
  const monad = chains.find((c) => c.name === "Monad");
  const ranked = chains.filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl);
  const top = protocols
    .filter((p) => p.chains?.includes("Monad") && typeof p.chainTvls?.Monad === "number")
    .sort((a, b) => b.chainTvls.Monad - a.chainTvls.Monad)
    .slice(0, 15)
    .map((p) => ({ name: p.name, category: p.category, monadTvlUsd: Math.round(p.chainTvls.Monad), url: p.url, defillama: `https://defillama.com/protocol/${p.slug}` }));
  const last30 = hist.slice(-30);
  const categories: Record<string, number> = {};
  for (const p of protocols.filter((p) => p.chains?.includes("Monad"))) categories[p.category] = (categories[p.category] ?? 0) + 1;
  const data = {
    generatedAt: new Date().toISOString(),
    provider: "synapse-monad-data",
    sources: [
      { id: "defillama-chains", url: chainsUrl, title: "DefiLlama chains TVL" },
      { id: "defillama-monad-history", url: histUrl, title: "DefiLlama Monad TVL history" },
      { id: "defillama-protocols", url: protoUrl, title: "DefiLlama protocol registry" },
    ],
    chain: monad
      ? { name: monad.name, chainId: monad.chainId, token: monad.tokenSymbol, tvlUsd: Math.round(monad.tvl), tvlRank: ranked.findIndex((c) => c.name === "Monad") + 1 }
      : null,
    tvlHistory30d: last30.map((h) => ({ date: new Date(h.date * 1000).toISOString().slice(0, 10), tvlUsd: Math.round(h.tvl) })),
    protocolCount: protocols.filter((p) => p.chains?.includes("Monad")).length,
    categories,
    topProtocols: top,
  };
  cache = { at: Date.now(), data };
  return data;
}

app.get("/v1/monad/ecosystem", async (_req, res) => {
  try {
    res.json(await buildDataset());
  } catch (err) {
    // NOTE: if the handler fails, x402 middleware does not settle (settlement happens after a successful response).
    res.status(502).json({ error: "upstream data unavailable", detail: (err as Error).message });
  }
});

app.get("/v1/monad/deep-dive", async (_req, res) => {
  res.json({ note: "premium deep-dive", data: await buildDataset() });
});

app.listen(PORT, () => {
  console.log(`[paid-data] x402 service on :${PORT} network=${NETWORK} asset=${ASSET} payTo=${PAY_TO} facilitator=${FACILITATOR}`);
});
