import { getDb } from "@/server/db";
import { env } from "@/server/env";
import { handle, json } from "@/server/http";
import { seedWorkers, WORKERS } from "@/server/registry";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const db = getDb();
  seedWorkers(db);
  const rows = db.prepare(`SELECT * FROM workers`).all() as {
    id: string;
    status: string;
    last_heartbeat: number | null;
    pid: number | null;
    payee_address: string | null;
  }[];
  const fresh = Date.now() - env().LEASE_MS;
  return json({
    registry: "prototype (static allowlist — not a permissionless marketplace)",
    workers: WORKERS.map((w) => {
      const r = rows.find((x) => x.id === w.id);
      const online = Boolean(r?.last_heartbeat && r.last_heartbeat > fresh);
      return {
        ...w,
        payee: r?.payee_address ?? null,
        status: online ? r!.status : "OFFLINE",
        lastHeartbeat: r?.last_heartbeat ?? null,
        pid: online ? r?.pid : null,
      };
    }),
  });
});
