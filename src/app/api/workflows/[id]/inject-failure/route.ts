import { handle, json, requireOwner } from "@/server/http";
import { armFailure } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** Arms a REAL fault: Worker A's process exits right after its next durable checkpoint. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  return json(armFailure(id));
});
