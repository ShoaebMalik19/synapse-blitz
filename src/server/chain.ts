import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env";

export function monadChain() {
  const e = env();
  return defineChain({
    id: e.MONAD_CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [e.MONAD_RPC_URL] } },
    blockExplorers: { default: { name: "MonadVision", url: e.MONAD_TESTNET_EXPLORER_URL } },
    testnet: true,
  });
}

let _pub: ReturnType<typeof createPublicClient> | null = null;
export function publicClient() {
  if (!_pub) _pub = createPublicClient({ chain: monadChain(), transport: http(env().MONAD_RPC_URL, { timeout: 20_000 }) });
  return _pub;
}

export function walletFor(pk: Hex) {
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: monadChain(), transport: http(env().MONAD_RPC_URL, { timeout: 20_000 }) });
}

export class ChainMismatchError extends Error {}

/** Every signing path calls this first: refuses to sign if the RPC is not the configured chain. */
export async function assertExpectedChain(client: { getChainId: () => Promise<number> } = publicClient()) {
  const id = await client.getChainId();
  if (id !== env().MONAD_CHAIN_ID) {
    throw new ChainMismatchError(`RPC chainId ${id} does not match configured MONAD_CHAIN_ID ${env().MONAD_CHAIN_ID}; refusing to sign`);
  }
  return id;
}

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

const AUTH_USED_EVENT = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");

export interface UsdcTransferVerification {
  verified: boolean;
  reason?: string;
  blockNumber?: string;
  status?: string;
  transfer?: { from: string; to: string; value: string; logIndex: number };
  authorizationUsed?: boolean;
  checkedAt: number;
}

/**
 * Verify an x402 settlement against chain data — not against the provider's word.
 * Requires a successful receipt containing a USDC Transfer(payer -> payTo, amount)
 * emitted by the configured asset contract.
 */
export async function verifyUsdcTransfer(args: {
  txHash: Hex;
  asset: Address;
  from: Address;
  to: Address;
  amount: bigint;
  nonce?: Hex;
}): Promise<UsdcTransferVerification> {
  const pc = publicClient();
  const receipt = await pc.getTransactionReceipt({ hash: args.txHash });
  const out: UsdcTransferVerification = {
    verified: false,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    checkedAt: Date.now(),
  };
  if (receipt.status !== "success") return { ...out, reason: "transaction reverted" };
  const logs = parseEventLogs({ abi: ERC20_ABI, logs: receipt.logs, eventName: "Transfer" }).filter(
    (l) => l.address.toLowerCase() === args.asset.toLowerCase(),
  );
  const match = logs.find(
    (l) =>
      l.args.from.toLowerCase() === args.from.toLowerCase() &&
      l.args.to.toLowerCase() === args.to.toLowerCase() &&
      l.args.value === args.amount,
  );
  if (!match) return { ...out, reason: "no matching USDC Transfer log (payer -> payTo, amount)" };
  out.transfer = { from: match.args.from, to: match.args.to, value: match.args.value.toString(), logIndex: match.logIndex };
  if (args.nonce) {
    out.authorizationUsed = await pc.readContract({
      address: args.asset,
      abi: ERC20_ABI,
      functionName: "authorizationState",
      args: [args.from, args.nonce],
    });
  }
  out.verified = true;
  return out;
}

/** EIP-3009: has this authorization nonce been consumed on-chain? Used to reconcile unknown outcomes. */
export async function authorizationUsed(asset: Address, payer: Address, nonce: Hex): Promise<boolean> {
  return publicClient().readContract({ address: asset, abi: ERC20_ABI, functionName: "authorizationState", args: [payer, nonce] });
}

/** Look up the settlement tx for a consumed nonce via AuthorizationUsed logs (bounded block range). */
export async function findAuthorizationTx(asset: Address, payer: Address, nonce: Hex, lookbackBlocks = 5000n) {
  const pc = publicClient();
  const latest = await pc.getBlockNumber();
  const from = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;
  // Monad RPC limits eth_getLogs ranges; scan in chunks of 100 blocks.
  for (let start = latest; start > from; start -= 100n) {
    const s = start - 99n > from ? start - 99n : from;
    const logs = await pc.getLogs({
      address: asset,
      event: AUTH_USED_EVENT,
      args: { authorizer: payer, nonce },
      fromBlock: s,
      toBlock: start,
    });
    if (logs.length) return logs[0].transactionHash as Hex;
  }
  return null;
}

export async function balances(address: Address) {
  const e = env();
  const pc = publicClient();
  const [mon, usdc] = await Promise.all([
    pc.getBalance({ address }),
    pc
      .readContract({ address: e.X402_ASSET_ADDRESS as Address, abi: ERC20_ABI, functionName: "balanceOf", args: [address] })
      .catch(() => null),
  ]);
  return { monWei: mon.toString(), usdcBase: usdc === null ? null : usdc.toString() };
}
