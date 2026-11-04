/** Print wallet addresses + balances and integration readiness (never prints keys). */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { balances, publicClient } from "../src/server/chain";
import { env } from "../src/server/env";

async function main() {
  const e = env();
  console.log("RPC chainId:", await publicClient().getChainId(), "(expected", e.MONAD_CHAIN_ID + ")");
  for (const [name, key] of [["operator", e.OPERATOR_PRIVATE_KEY], ["worker-a", e.WORKER_A_PRIVATE_KEY], ["worker-b", e.WORKER_B_PRIVATE_KEY]] as const) {
    if (!key) { console.log(name, "not configured"); continue; }
    const a = privateKeyToAccount(key as Hex).address;
    const b = await balances(a);
    console.log(`${name.padEnd(9)} ${a}  MON=${Number(b.monWei) / 1e18}  USDC=${b.usdcBase === null ? "?" : Number(b.usdcBase) / 1e6}`);
  }
  console.log("payTo     ", e.X402_PAY_TO);
  console.log("escrow    ", e.MONAD_ESCROW_ADDRESS ?? "(not deployed)");
  const sup = await fetch(`${e.X402_FACILITATOR_URL}/supported`).then((r) => r.json()).catch(() => null);
  const ok = sup?.kinds?.some((k: { network: string; scheme: string }) => k.network === e.X402_NETWORK_ID && k.scheme === "exact");
  console.log("facilitator exact @", e.X402_NETWORK_ID, ok ? "SUPPORTED" : "NOT SUPPORTED / unreachable");
}
main();
