import { handle, json, requireOwner } from "@/server/http";
import { paymentsView } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  return json(paymentsView(id));
});
