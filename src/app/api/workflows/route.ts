import { z } from "zod";
import { budgetSchema } from "@/server/budget-input";
import { handle, json, requireSession } from "@/server/http";
import { createWorkflow, listWorkflows } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireSession();
  return json({ workflows: listWorkflows() });
});

export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  const body = z.object({ goal: z.string().trim().min(10).max(500), budget: budgetSchema() }).parse(await req.json());
  const id = await createWorkflow(body.goal, body.budget, s.sub);
  return json({ id }, 201);
});
