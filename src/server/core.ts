import crypto from "node:crypto";
import { getDb, now, type DB } from "./db";

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

export function sha256Hex(data: string): string {
  return "0x" + crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Stable JSON stringify (sorted keys) so hashes are deterministic. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export type EventLevel = "info" | "warn" | "error" | "success";

export function emit(
  workflowId: string,
  type: string,
  message: string,
  opts: { taskId?: string; workerId?: string; level?: EventLevel; data?: unknown; db?: DB } = {},
) {
  const db = opts.db ?? getDb();
  db.prepare(
    `INSERT INTO workflow_events (workflow_id, task_id, worker_id, type, level, message, data_json, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    workflowId,
    opts.taskId ?? null,
    opts.workerId ?? null,
    type,
    opts.level ?? "info",
    message,
    opts.data === undefined ? null : JSON.stringify(opts.data),
    now(),
  );
}

export function storeArtifact(
  a: { workflowId: string; taskId?: string; kind: string; mime: string; content: string; producedBy?: string },
  db: DB = getDb(),
) {
  const id = newId("art");
  const sha = sha256Hex(a.content);
  db.prepare(
    `INSERT INTO artifacts (id, workflow_id, task_id, kind, mime, content, sha256, produced_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, a.workflowId, a.taskId ?? null, a.kind, a.mime, a.content, sha, a.producedBy ?? null, now());
  return { id, sha256: sha };
}

export function getArtifact(id: string, db: DB = getDb()) {
  return db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
    | {
        id: string;
        workflow_id: string;
        task_id: string | null;
        kind: string;
        mime: string;
        content: string;
        sha256: string;
        produced_by: string | null;
        created_at: number;
      }
    | undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Decimal string -> base units bigint (no float math). */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal amount: ${s}`);
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function formatUnits(base: bigint | string, decimals: number, maxFrac = 6): string {
  const b = BigInt(base);
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const d = 10n ** BigInt(decimals);
  const i = abs / d;
  let f = (abs % d).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (!f) f = "";
  return `${neg ? "-" : ""}${i}${f ? "." + f : ""}`;
}
