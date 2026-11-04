import { z } from "zod";
import { env } from "./env";

/** Budget request from the dashboard. Server-side ceilings (POLICY_*) can only be lowered by the user. */
export function budgetSchema() {
  const e = env();
  const dec = (max: number, label: string) => z.number().min(0).max(max, `${label} cannot exceed server ceiling ${max}`);
  return z
    .object({
      x402Usdc: dec(e.POLICY_MAX_X402_USDC, "x402 budget"),
      perCallUsdc: dec(e.POLICY_MAX_PER_CALL_USDC, "per-call cap"),
      approvalThresholdUsdc: dec(e.POLICY_APPROVAL_THRESHOLD_USDC, "approval threshold"),
      escrowMon: dec(e.POLICY_MAX_ESCROW_MON, "escrow").refine((v) => v > 0, "escrow must be > 0"),
      gasMon: dec(e.POLICY_MAX_GAS_MON, "gas allowance"),
    })
    .refine((b) => b.perCallUsdc <= b.x402Usdc, { message: "per-call cap must be <= total x402 budget", path: ["perCallUsdc"] });
}

export function defaultBudget() {
  const e = env();
  return {
    x402Usdc: e.POLICY_MAX_X402_USDC,
    perCallUsdc: e.POLICY_MAX_PER_CALL_USDC,
    approvalThresholdUsdc: e.POLICY_APPROVAL_THRESHOLD_USDC,
    escrowMon: e.POLICY_MAX_ESCROW_MON,
    gasMon: e.POLICY_MAX_GAS_MON,
  };
}
