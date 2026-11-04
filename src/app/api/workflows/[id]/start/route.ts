import { z } from "zod";
import { handle, json, requireOwner } from "@/server/http";
import { approveWorkflow } from "@/server/workflows";

export const dynamic = "force-dynamic";

/** Operator approves the plan + budget; the orchestrator then commits/funds escrow and releases tasks. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  const body = z
    .object({ failureDrill: z.boolean().default(false), approveHighValue: z.boolean().default(false) })
    .parse(await req.json().catch(() => ({})));
  const wf = approveWorkflow(id, body);
  return json({ id: wf.id, status: wf.status });
});
