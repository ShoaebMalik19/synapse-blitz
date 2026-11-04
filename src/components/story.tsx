"use client";

import { BadgeCheck, Brain, CircleDollarSign, Landmark, RotateCcw, Skull } from "lucide-react";
import type { ComponentType } from "react";
import { fmtMon, fmtUsdc, plannerLabel, shortHash, type EscrowRow, type PaymentRow, type WorkflowDetail } from "@/lib/client";
import { cx, Ext } from "./ui";

export type StepState = "done" | "active" | "pending" | "blocked" | "skipped";

export interface StoryStep {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  state: StepState;
  detail: string;
  link?: { href: string; label: string } | null;
}

/**
 * Derive the six demo milestones from persisted run data only (tasks, attempts, faults,
 * payment and escrow operations). Nothing here is hardcoded to "success".
 */
export function deriveStory(wf: WorkflowDetail, payments: PaymentRow[], escrow: EscrowRow[]): StoryStep[] {
  const w = wf.workflow;
  const running = ["APPROVED", "ACTIVE"].includes(w.status);
  const research = wf.tasks.filter((t) => t.capability === "research");
  const researchDone = research.length > 0 && research.every((t) => t.status === "COMPLETED");
  const synth = wf.tasks.find((t) => t.capability === "synthesis");
  const confirmed = payments.filter((p) => p.status === "CONFIRMED");
  const blocked = payments.find((p) => p.status === "RELEASED" || p.status === "FAILED");
  const unknown = payments.find((p) => p.status === "UNKNOWN" || p.status === "SUBMITTED" || p.status === "RESERVED");
  const fired = wf.faults.find((f) => f.status === "FIRED");
  const armed = wf.faults.find((f) => f.status === "ARMED");
  const failedA = wf.attempts.find((a) => a.worker_id === "worker-a" && a.status === "FAILED");
  const recovery = wf.attempts.find((a) => a.kind === "RECOVERY");
  const recoveryCp = recovery?.resumed_from_checkpoint ? wf.checkpoints.find((c) => c.id === recovery.resumed_from_checkpoint) : null;
  const accept = escrow.find((e) => e.action === "ACCEPT");
  const fund = escrow.find((e) => e.action === "FUND");
  const done = wf.tasks.filter((t) => t.status === "COMPLETED").length;

  const steps: StoryStep[] = [];

  steps.push({
    key: "plan",
    title: "Plan created",
    icon: Brain,
    state: w.status === "APPROVAL_REQUIRED" ? "active" : "done",
    detail:
      w.status === "APPROVAL_REQUIRED"
        ? `${plannerLabel(w.planner, w.plannerSource)} drafted ${wf.tasks.length} tasks · awaiting approval`
        : `${plannerLabel(w.planner, w.plannerSource)} · ${wf.tasks.length}-task DAG validated`,
  });

  let x402: StoryStep;
  if (confirmed.length >= 1) {
    const p = confirmed[0];
    x402 = {
      key: "x402",
      title: confirmed.length === 1 ? "x402 paid once" : `x402 paid ${confirmed.length}×`,
      icon: CircleDollarSign,
      state: "done",
      detail: `${fmtUsdc(confirmed.reduce((s, c) => s + BigInt(c.amount_base), 0n).toString())} USDC · Transfer log verified on Monad`,
      link: p.explorer_url ? { href: p.explorer_url, label: shortHash(p.tx_hash, 4) } : null,
    };
  } else if (unknown) {
    x402 = { key: "x402", title: "x402 payment", icon: CircleDollarSign, state: "active", detail: `${unknown.status.toLowerCase()} · reconciling before any retry` };
  } else if (blocked) {
    x402 = { key: "x402", title: "x402 not charged", icon: CircleDollarSign, state: "blocked", detail: (blocked.status_reason ?? "blocked").replace(/^blocked: /, "").slice(0, 90) };
  } else if (researchDone || ["COMPLETED", "FAILED", "CANCELLED"].includes(w.status)) {
    x402 = { key: "x402", title: "x402 not charged", icon: CircleDollarSign, state: "blocked", detail: "no paid purchase settled in this run" };
  } else {
    x402 = { key: "x402", title: "x402 purchase", icon: CircleDollarSign, state: running ? "active" : "pending", detail: running ? "worker buying data over HTTP 402" : "after approval" };
  }
  steps.push(x402);

  steps.push(
    fired || failedA
      ? {
          key: "crash",
          title: "Worker A crashed",
          icon: Skull,
          state: "done",
          detail: failedA?.failure_reason ? `${failedA.failure_reason}` : "process terminated after a checkpoint",
        }
      : armed
        ? { key: "crash", title: "Failure drill armed", icon: Skull, state: running ? "active" : "pending", detail: "Worker A will exit after its next checkpoint" }
        : { key: "crash", title: "Worker failure", icon: Skull, state: running || w.status === "APPROVAL_REQUIRED" ? "pending" : "skipped", detail: "no failure drill in this run" },
  );

  steps.push(
    recovery
      ? {
          key: "resume",
          title: "Worker B resumed",
          icon: RotateCcw,
          state: recovery.status === "SUCCEEDED" ? "done" : recovery.status === "RUNNING" ? "active" : "blocked",
          detail: `${recoveryCp ? `from checkpoint seq ${recoveryCp.seq}` : "fresh retry"}${confirmed.length === 1 ? " · purchase not repeated" : ""}`,
        }
      : fired || failedA
        ? { key: "resume", title: "Recovery", icon: RotateCcw, state: "active", detail: "waiting for lease expiry and a backup worker" }
        : { key: "resume", title: "Recovery", icon: RotateCcw, state: fired || armed || running ? "pending" : "skipped", detail: "not needed" },
  );

  steps.push({
    key: "verify",
    title: "Briefing verified",
    icon: BadgeCheck,
    state: synth?.status === "COMPLETED" ? "done" : w.status === "FAILED" ? "blocked" : running && done > 0 ? "active" : "pending",
    detail: synth?.status === "COMPLETED" ? `${done}/${wf.tasks.length} tasks passed deterministic checks` : `${done}/${wf.tasks.length} tasks verified`,
  });

  steps.push(
    w.settlementStatus === "SETTLED"
      ? {
          key: "escrow",
          title: "Escrow settled",
          icon: Landmark,
          state: "done",
          detail: `${fmtMon(fund?.amount_wei ?? null, 2)} MON paid to Worker B on accepted hash`,
          link: accept?.explorer_url ? { href: accept.explorer_url, label: shortHash(accept.tx_hash, 4) } : null,
        }
      : w.settlementStatus === "SETTLING"
        ? { key: "escrow", title: "Escrow settling", icon: Landmark, state: "active", detail: "submitResult → acceptResult on Monad" }
        : w.settlementStatus === "BLOCKED" || w.settlementStatus === "FAILED"
          ? { key: "escrow", title: `Escrow ${w.settlementStatus.toLowerCase()}`, icon: Landmark, state: "blocked", detail: (w.settlementNote ?? "").slice(0, 90) }
          : w.settlementStatus === "FUNDED"
            ? { key: "escrow", title: "Escrow funded", icon: Landmark, state: "pending", detail: `${fmtMon(fund?.amount_wei ?? null, 2)} MON locked until the result is accepted`, link: fund?.explorer_url ? { href: fund.explorer_url, label: shortHash(fund.tx_hash, 4) } : null }
            : { key: "escrow", title: "Escrow", icon: Landmark, state: running ? "active" : "pending", detail: running ? "committing task on Monad" : "funded on approval" },
  );
  return steps;
}

const stateStyle: Record<StepState, { ring: string; text: string; label: string }> = {
  done: { ring: "border-ok/50 bg-ok/15 text-ok", text: "text-fg", label: "done" },
  active: { ring: "border-blue bg-blue/15 text-blue", text: "text-fg", label: "in progress" },
  pending: { ring: "border-line-strong bg-fg/[0.03] text-dim", text: "text-muted", label: "pending" },
  blocked: { ring: "border-warn/50 bg-warn/15 text-warn", text: "text-fg", label: "blocked" },
  skipped: { ring: "border-line bg-transparent text-dim", text: "text-dim", label: "skipped" },
};

export function StoryStepper({ steps, compact = false }: { steps: StoryStep[]; compact?: boolean }) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  return (
    <div>
      <div className="sr-only" aria-live="polite">
        {doneCount} of {steps.length} milestones complete
      </div>
      <ol className={cx("grid gap-2", compact ? "grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6")}>
        {steps.map((s, i) => {
          const st = stateStyle[s.state];
          const Icon = s.icon;
          const incident = s.key === "crash" && s.state === "done";
          return (
            <li
              key={`${s.key}-${s.state}`}
              className={cx(
                "anim-fade-up relative flex gap-3 rounded-[4px] border p-3",
                incident ? "border-2 border-accent bg-surface" : s.state === "active" ? "border-2 border-blue bg-blue/[0.06]" : s.state === "blocked" ? "border-warn/50 bg-warn/[0.06]" : "border-line-strong bg-surface",
              )}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className={cx("grid size-8 shrink-0 place-items-center rounded-[4px] border", incident ? "border-accent bg-accent text-on-accent" : st.ring)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <span className={cx("text-[13px] font-semibold leading-tight", st.text)}>{s.title}</span>
                </div>
                {!compact && <div className="mt-1 text-[11.5px] leading-snug text-muted [overflow-wrap:anywhere]">{s.detail}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-wide text-dim">
                  <span className={s.state === "done" ? "text-ok" : s.state === "blocked" ? "text-warn" : s.state === "active" ? "text-blue" : ""}>{st.label}</span>
                  {s.link && (
                    <Ext href={s.link.href} className="normal-case tracking-normal">
                      {s.link.label}
                    </Ext>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
