import { handle, json, requireOwner } from "@/server/http";
import { cancelWorkflow } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  cancelWorkflow(id);
  return json({ ok: true });
});
