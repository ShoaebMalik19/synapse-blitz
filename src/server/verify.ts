import { getArtifact, sha256Hex } from "./core";
import { getDb, type DB } from "./db";
import { getTask, type TaskRow } from "./tasks";

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}
export interface VerificationReport {
  passed: boolean;
  checks: CheckResult[];
  verifiedAt: number;
}

const isUrl = (u: unknown) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);

/** Deterministic, capability-specific output checks. No LLM grading. */
export function verifyOutput(
  task: Pick<TaskRow, "workflow_id" | "task_id" | "capability" | "dependencies_json">,
  output: unknown,
  artifactId: string,
  db: DB = getDb(),
): VerificationReport {
  const checks: CheckResult[] = [];
  const add = (id: string, label: string, passed: boolean, detail?: string) => checks.push({ id, label, passed, detail });
  const o = (output ?? {}) as Record<string, unknown>;

  // Common checks
  const deps: string[] = JSON.parse(task.dependencies_json);
  const unmet = deps.filter((d) => getTask(task.workflow_id, d, db)?.status !== "COMPLETED");
  add("deps", "All dependencies completed", unmet.length === 0, unmet.length ? `unmet: ${unmet.join(",")}` : undefined);
  const art = getArtifact(artifactId, db);
  add("artifact", "Output artifact stored", Boolean(art));
  add("hash", "Artifact hash matches persisted content", Boolean(art && sha256Hex(art.content) === art.sha256));
  const unresolved = db
    .prepare(`SELECT COUNT(*) c FROM payment_operations WHERE workflow_id = ? AND task_id = ? AND status IN ('SUBMITTED','UNKNOWN')`)
    .get(task.workflow_id, task.task_id) as { c: number };
  add("payments", "No unresolved payment operations", unresolved.c === 0, unresolved.c ? `${unresolved.c} unresolved` : undefined);

  if (task.capability === "research") {
    const sources = Array.isArray(o.sources) ? (o.sources as { id: string; url: string }[]) : [];
    const facts = Array.isArray(o.facts) ? (o.facts as { id: string; sourceId: string; claim: string }[]) : [];
    const ids = new Set(sources.map((s) => s.id));
    add("sources", "≥3 sources with valid URLs", sources.filter((s) => isUrl(s.url)).length >= 3, `${sources.length} sources`);
    add("facts", "≥3 extracted facts", facts.length >= 3, `${facts.length} facts`);
    const orphan = facts.filter((f) => !ids.has(f.sourceId));
    add("citations", "Every fact references a known source", facts.length > 0 && orphan.length === 0, orphan.length ? `${orphan.length} uncited` : undefined);
    const ds = o.dataset as { status?: string; paymentId?: string; reason?: string } | undefined;
    add(
      "dataset",
      "Paid dataset receipt recorded or purchase explicitly blocked",
      Boolean(ds && (ds.status === "PAID" || ds.status === "REUSED" ? ds.paymentId : ds.reason)),
      ds ? `${ds.status}` : "missing",
    );
  } else if (task.capability === "analysis") {
    const insights = Array.isArray(o.insights) ? (o.insights as { evidence: string[] }[]) : [];
    const factIds = new Set((o.knownFactIds as string[] | undefined) ?? []);
    add("insights", "≥3 insights", insights.length >= 3, `${insights.length}`);
    const uncited = insights.filter((i) => !Array.isArray(i.evidence) || !i.evidence.length || !i.evidence.every((e) => factIds.has(e)));
    add("evidence", "Every insight cites research facts", insights.length > 0 && uncited.length === 0, uncited.length ? `${uncited.length} uncited` : undefined);
    add("risks", "Risks section present", Array.isArray(o.risks) && (o.risks as unknown[]).length > 0);
  } else if (task.capability === "synthesis") {
    const md = typeof o.markdown === "string" ? o.markdown : "";
    for (const h of ["Executive Summary", "Recommendations", "Sources"])
      add(`section:${h}`, `Report has "${h}" section`, new RegExp(`^##\\s+${h}`, "m").test(md));
    const links = md.match(/https?:\/\/[^\s)\]]+/g) ?? [];
    add("links", "≥3 source links in report", new Set(links).size >= 3, `${new Set(links).size} links`);
    add("length", "Report has substantive content (≥ 1500 chars)", md.length >= 1500, `${md.length} chars`);
  } else {
    add("capability", "Known capability", false, task.capability);
  }

  return { passed: checks.every((c) => c.passed), checks, verifiedAt: Date.now() };
}
