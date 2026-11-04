import { handle, json, requireOwner } from "@/server/http";
import { resultView } from "@/server/workflows";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwner(id);
  const r = await resultView(id);
  if (new URL(req.url).searchParams.get("format") === "md") {
    if (!r?.report) return json({ error: "report not ready" }, 404);
    return new Response(r.report.markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="synapse-briefing-${id}.md"`,
        "x-content-sha256": r.report.sha256,
      },
    });
  }
  return json(r);
});
