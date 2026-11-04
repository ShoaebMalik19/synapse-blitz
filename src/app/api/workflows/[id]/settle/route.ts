import { handle, json, requireOwner } from "@/server/http";
import { retrySettlement } from "@/server/orchestrator";
import { HttpError } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** Retry a FAILED settlement. Idempotent: already-broadcast txs are reconciled, never re-sent. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  try {
    return json(await retrySettlement(id));
  } catch (err) {
    throw new HttpError(409, (err as Error).message);
  }
});
