import { getDb } from "@/server/db";
import { handle, json, requireOwner } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  const events = getDb()
    .prepare(
      `SELECT id, task_id, worker_id, type, level, message, data_json, created_at FROM workflow_events WHERE workflow_id = ? AND id > ? ORDER BY id LIMIT 500`,
    )
    .all(id, after) as { data_json: string | null }[];
  return json({ events: events.map((e) => ({ ...e, data: e.data_json ? JSON.parse(e.data_json) : null, data_json: undefined })) });
});
