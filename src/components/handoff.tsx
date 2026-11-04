"use client";

import { ArrowRight, Bot, Cpu, Database } from "lucide-react";
import { clock, type Attempt, type CheckpointRow, type PaymentRow } from "@/lib/client";
import { Badge, cx } from "./ui";

/** Visualizes the real failover: failed attempt → checkpoint → recovery attempt, from persisted rows. */
export function RecoveryHandoff({ attempts, checkpoints, payments }: { attempts: Attempt[]; checkpoints: CheckpointRow[]; payments: PaymentRow[] }) {
  const rec = attempts.find((a) => a.kind === "RECOVERY");
  if (!rec) return null;
  const failed = attempts.filter((a) => a.task_id === rec.task_id && a.attempt_no < rec.attempt_no && a.status === "FAILED").at(-1);
  const cp = checkpoints.find((c) => c.id === rec.resumed_from_checkpoint);
  const steps: string[] = cp ? JSON.parse(cp.completed_steps_json) : [];
  const later = checkpoints.filter((c) => c.task_id === rec.task_id && c.worker_id === rec.worker_id && c.created_at >= rec.started_at);
  const paid = payments.filter((p) => p.status === "CONFIRMED" && p.task_id === rec.task_id);
  const live = rec.status === "RUNNING";
  return (
    <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <Side
        icon={<Bot className="size-4 text-blue" aria-hidden />}
        who={failed?.worker_id ?? "worker-a"}
        title={`Attempt #${failed?.attempt_no ?? "?"} · ${failed?.kind ?? "INITIAL"}`}
        status={<Badge t="bad">failed</Badge>}
        lines={[failed?.failure_reason ?? "terminated", failed ? `${clock(failed.started_at)} → ${failed.ended_at ? clock(failed.ended_at) : "—"}` : ""]}
      />
      <Arrow live={live} />
      <div className="rounded-[4px] border-2 border-ok/60 bg-ok/[0.06] p-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Database className="size-4 text-ok" aria-hidden /> Checkpoint seq {cp?.seq ?? "—"}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {steps.map((s) => (
            <span key={s} className="rounded-[3px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
              ✓ {s}
            </span>
          ))}
        </div>
        <div className="mt-2 font-mono text-[10.5px] text-dim [overflow-wrap:anywhere]" title={cp?.state_hash}>
          state hash {cp?.state_hash.slice(0, 18)}… verified on load
        </div>
      </div>
      <Arrow live={live} />
      <Side
        icon={<Cpu className="size-4 text-wb" aria-hidden />}
        who={rec.worker_id}
        title={`Attempt #${rec.attempt_no} · RECOVERY`}
        status={<Badge t={rec.status === "SUCCEEDED" ? "ok" : rec.status === "RUNNING" ? "blue" : "bad"}>{rec.status.toLowerCase()}</Badge>}
        lines={[
          `skipped ${steps.length} completed step${steps.length === 1 ? "" : "s"}; +${later.length} new checkpoint${later.length === 1 ? "" : "s"}`,
          paid.length === 1 ? "x402 purchase reused — no second charge" : paid.length === 0 ? "no paid purchase in this task" : `${paid.length} confirmed purchases`,
        ]}
      />
    </div>
  );
}

function Side({ icon, who, title, status, lines }: { icon: React.ReactNode; who: string; title: string; status: React.ReactNode; lines: string[] }) {
  return (
    <div className="rounded-[4px] border border-line-strong bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          {icon} {who}
        </div>
        {status}
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted">{title}</div>
      {lines.filter(Boolean).map((l) => (
        <div key={l} className="mt-1 text-[11.5px] leading-snug text-dim [overflow-wrap:anywhere]">
          {l}
        </div>
      ))}
    </div>
  );
}

function Arrow({ live }: { live: boolean }) {
  return (
    <div className="relative flex items-center justify-center overflow-hidden py-1 md:w-10" aria-hidden>
      <ArrowRight className="size-4 rotate-90 text-dim md:rotate-0" />
      <span className={cx("absolute inset-x-0 top-1/2 hidden h-px bg-gradient-to-r from-transparent via-blue to-transparent md:block", live ? "anim-travel" : "opacity-0")} />
    </div>
  );
}
