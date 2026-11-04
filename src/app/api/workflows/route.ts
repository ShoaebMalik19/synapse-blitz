import { z } from "zod";
import { budgetSchema } from "@/server/budget-input";
import { handle, json, requireSession } from "@/server/http";
import { createWorkflow, listWorkflows, workflowView } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireSession();
  return json({ workflows: listWorkflows() });
});

export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  const body = z
    .object({
      goal: z.string().trim().min(10, "describe the goal in at least 10 characters").max(500, "keep the goal under 500 characters"),
      budget: budgetSchema(),
    })
    .parse(await req.json());
  const id = await createWorkflow(body.goal, body.budget, s.sub);
  const v = workflowView(id)!;
  return json({ id, status: v.workflow.status, planner: v.workflow.planner, source: v.workflow.plannerSource, notes: v.workflow.plannerNotes }, 201);
});
