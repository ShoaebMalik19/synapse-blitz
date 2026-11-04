import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { balances, publicClient } from "@/server/chain";
import { env, explorerAddress } from "@/server/env";
import { handle, json } from "@/server/http";
import { llmConfigured } from "@/server/planner";
import { defaultBudget } from "@/server/budget-input";

export const dynamic = "force-dynamic";

async function safe<T>(p: Promise<T>): Promise<T | { error: string }> {
  try {
    return await p;
  } catch (e) {
    return { error: (e as Error).message.slice(0, 160) };
  }
}
const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

export const GET = handle(async () => {
  const e = env();
  const pc = publicClient();
  const [chainId, block, facilitator, service] = await Promise.all([
    safe(pc.getChainId()),
    safe(pc.getBlockNumber().then(String)),
    safe(fetch(`${e.X402_FACILITATOR_URL}/supported`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json())),
    safe(fetch(`${e.X402_SERVICE_URL}/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json())),
  ]);
  const operator = e.OPERATOR_PRIVATE_KEY ? privateKeyToAccount(e.OPERATOR_PRIVATE_KEY as Hex).address : null;
  const opBal = operator ? await safe(balances(operator)) : null;
  const escrowCode = e.MONAD_ESCROW_ADDRESS ? await safe(pc.getCode({ address: e.MONAD_ESCROW_ADDRESS as Hex })) : null;
  const kinds = isErr(facilitator) ? [] : ((facilitator as { kinds?: { network: string; scheme: string }[] }).kinds ?? []);
  return json({
    chain: {
      expectedChainId: e.MONAD_CHAIN_ID,
      rpcChainId: isErr(chainId) ? null : chainId,
      error: isErr(chainId) ? chainId.error : null,
      match: chainId === e.MONAD_CHAIN_ID,
      rpc: e.MONAD_RPC_URL,
      blockNumber: isErr(block) ? null : block,
      explorer: e.MONAD_TESTNET_EXPLORER_URL,
    },
    operator: operator
      ? { address: operator, explorer: explorerAddress(operator), balances: isErr(opBal) ? null : opBal, error: isErr(opBal) ? opBal.error : null }
      : null,
    escrow: {
      address: e.MONAD_ESCROW_ADDRESS ?? null,
      deployed: typeof escrowCode === "string" && escrowCode.length > 2,
      explorer: e.MONAD_ESCROW_ADDRESS ? explorerAddress(e.MONAD_ESCROW_ADDRESS) : null,
    },
    x402: {
      facilitator: e.X402_FACILITATOR_URL,
      network: e.X402_NETWORK_ID,
      asset: e.X402_ASSET_ADDRESS,
      payTo: e.X402_PAY_TO ?? null,
      exactSupported: kinds.some((k) => k.network === e.X402_NETWORK_ID && k.scheme === "exact"),
      facilitatorError: isErr(facilitator) ? facilitator.error : null,
      service: isErr(service) ? { online: false, url: e.X402_SERVICE_URL, error: service.error } : { online: true, url: e.X402_SERVICE_URL },
    },
    llm: { configured: llmConfigured(), model: llmConfigured() ? e.LLM_MODEL : null },
    policyDefaults: defaultBudget(),
  });
});
