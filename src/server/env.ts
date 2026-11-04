import "dotenv/config";
import { z } from "zod";

const hexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const addr = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const schema = z.object({
  MONAD_RPC_URL: z.string().url().default("https://testnet-rpc.monad.xyz"),
  MONAD_CHAIN_ID: z.coerce.number().int().default(10143),
  MONAD_ESCROW_ADDRESS: addr,
  MONAD_TESTNET_EXPLORER_URL: z.string().url().default("https://testnet.monadvision.com"),

  X402_FACILITATOR_URL: z.string().url().default("https://x402-facilitator.molandak.org"),
  X402_NETWORK_ID: z.string().default("eip155:10143"),
  X402_ASSET_ADDRESS: z.string().default("0x534b2f3A21130d7a60830c2Df862319e593943A3"),
  X402_PAY_TO: addr,
  X402_SERVICE_URL: z.string().url().default("http://localhost:4021"),
  X402_SERVICE_PORT: z.coerce.number().int().default(4021),

  LLM_API_KEY: z.string().optional().default(""),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_REASONING_EFFORT: z
    .enum(["low", "medium", "high"])
    .optional()
    .or(z.literal("").transform(() => undefined)),

  DATABASE_URL: z.string().default("file:./data/synapse.db"),
  SESSION_SECRET: z.string().optional().default(""),
  OPERATOR_ACCESS_TOKEN: z.string().optional().default(""),

  OPERATOR_PRIVATE_KEY: hexKey,
  WORKER_A_PRIVATE_KEY: hexKey,
  WORKER_B_PRIVATE_KEY: hexKey,

  POLICY_MAX_X402_USDC: z.coerce.number().default(0.05),
  POLICY_MAX_PER_CALL_USDC: z.coerce.number().default(0.02),
  POLICY_APPROVAL_THRESHOLD_USDC: z.coerce.number().default(0.015),
  POLICY_MAX_ESCROW_MON: z.coerce.number().default(0.01),
  POLICY_MAX_GAS_MON: z.coerce.number().default(0.05),

  LEASE_MS: z.coerce.number().int().default(8000),
  DEMO_STEP_DELAY_MS: z.coerce.number().int().default(1500),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** For tests: override env values. */
export function setEnvForTests(overrides: Partial<Record<keyof Env, unknown>>) {
  cached = schema.parse({ ...process.env, ...overrides });
}

export const USDC_DECIMALS = 6;
export const MON_DECIMALS = 18;

export function explorerTx(hash: string) {
  return `${env().MONAD_TESTNET_EXPLORER_URL}/tx/${hash}`;
}
export function explorerAddress(a: string) {
  return `${env().MONAD_TESTNET_EXPLORER_URL}/address/${a}`;
}
