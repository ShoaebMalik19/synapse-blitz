"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EventRow } from "@/lib/client";
import { cx } from "./ui";

/* ==========================================================================
   Recorder Tape — a flight-data-recorder view of one workflow.
   One lane per actor; each mark is a recorded event at its real time offset.
   A lane's trace is solid while that actor is active, so a crash visibly ends
   Worker A's line and Worker B's line starts where it resumes.
   ========================================================================== */

export type Channel = "orch" | "worker-a" | "worker-b" | "chain";
export type MarkKind = "step" | "plan" | "pay" | "reject" | "checkpoint" | "crash" | "warn" | "resume" | "escrow" | "settle" | "done";

export interface TapeMark {
  id: string | number;
  t: number; // ms (any origin; normalised against start/end)
  channel: Channel;
  kind: MarkKind;
  label: string;
}

const CHANNELS: { id: Channel; name: string; role: string; color: string }[] = [
  { id: "orch", name: "ORCH", role: "Orchestrator", color: "var(--fg)" },
  { id: "worker-a", name: "W·A", role: "Research", color: "var(--blue)" },
  { id: "worker-b", name: "W·B", role: "Analysis + backup", color: "var(--wb)" },
  { id: "chain", name: "MONAD", role: "Testnet chain", color: "var(--accent-ink)" },
];

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Glyph({ kind, color }: { kind: MarkKind; color: string }) {
  switch (kind) {
    case "crash":
      return (
        <span className="grid size-5 place-items-center rounded-[2px] bg-accent text-on-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]">
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      );
    case "pay":
      return <span className="block size-3 rounded-full border-2 border-surface bg-blue ring-1 ring-blue" />;
    case "reject":
      return (
        <span className="grid size-3.5 place-items-center rounded-full border-2 border-bad bg-surface">
          <span className="block h-[2px] w-2 rotate-45 bg-bad" />
        </span>
      );
    case "checkpoint":
      return <span className="block h-3.5 w-[3px] rounded-[1px]" style={{ background: color }} />;
    case "resume":
      return (
        <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
          <path d="M2 1.5l9 4.5-9 4.5z" fill="var(--green)" />
        </svg>
      );
    case "warn":
      return <span className="block size-2.5 rotate-45 border-2 border-warn bg-surface" />;
    case "escrow":
      return <span className="block size-2.5 rounded-[1px] border-2 border-fg bg-surface" />;
    case "settle":
      return (
        <span className="grid size-4 place-items-center rounded-[2px] bg-ok text-surface">
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path d="M2 5.2l2 2L8 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "plan":
    case "done":
      return <span className="block size-2.5 rounded-full border-2 bg-surface" style={{ borderColor: color }} />;
    default:
      return <span className="block size-1.5 rounded-full opacity-60" style={{ background: color }} />;
  }
}

export function RecorderTape({
  marks,
  start,
  end,
  reveal,
  live = false,
  className,
  caption,
}: {
  marks: TapeMark[];
  start: number;
  end: number;
  /** 0..1 — marks after this point are hidden and the playhead sits here. Omit to show all. */
  reveal?: number;
  live?: boolean;
  className?: string;
  caption?: (latest: TapeMark | null) => React.ReactNode;
}) {
  const span = Math.max(1, end - start);
  const pos = (t: number) => Math.max(0, Math.min(1, (t - start) / span));
  const cut = reveal ?? 1;
  const shown = marks.filter((m) => pos(m.t) <= cut + 1e-9);
  const latest = shown.length ? shown.reduce((a, b) => (b.t >= a.t ? b : a)) : null;
  const crash = shown.find((m) => m.kind === "crash");
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  // Active range per lane (first → last significant mark), clipped to the reveal point.
  const ranges = CHANNELS.map((c) => {
    const ms = shown.filter((m) => m.channel === c.id);
    if (!ms.length) return null;
    const a = Math.min(...ms.map((m) => pos(m.t)));
    const ended = ms.some((m) => m.kind === "crash");
    const last = Math.max(...ms.map((m) => pos(m.t)));
    const b = !ended && reveal !== undefined ? Math.max(cut, last) : last;
    return { a, b: Math.min(b, cut) };
  });

  return (
    <div className={cx("min-w-0", className)}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[112px_1fr]">
          {/* Lane labels */}
          <div className="border-r border-line-strong">
            {CHANNELS.map((c) => (
              <div key={c.id} className="flex h-11 flex-col justify-center border-b border-line px-3 last:border-b-0">
                <span className="placard flex items-center gap-1.5 text-fg">
                  <span className="inline-block h-2.5 w-1 rounded-[1px]" style={{ background: c.color }} aria-hidden />
                  {c.name}
                </span>
                <span className="truncate text-[10.5px] text-dim">{c.role}</span>
              </div>
            ))}
          </div>

          {/* Tracks on chart paper */}
          <div className="chart-paper relative">
            {CHANNELS.map((c, i) => (
              <div key={c.id} className="relative h-11 border-b border-line last:border-b-0">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-strong" />
                {ranges[i] && (
                  <div
                    className="absolute top-1/2 h-[2px] -translate-y-1/2"
                    style={{ left: `${ranges[i]!.a * 100}%`, width: `${Math.max(0.3, (ranges[i]!.b - ranges[i]!.a) * 100)}%`, background: c.color }}
                  />
                )}
                {shown
                  .filter((m) => m.channel === c.id)
                  .map((m) => (
                    <span
                      key={m.id}
                      role="img"
                      aria-label={`${fmtElapsed(m.t - start)} ${c.role}: ${m.label}`}
                      title={`${fmtElapsed(m.t - start)} · ${m.label}`}
                      className={cx("absolute top-1/2 z-10", m.kind === "crash" && "z-20")}
                      style={{ left: `${pos(m.t) * 100}%`, transform: "translate(-50%,-50%)" }}
                    >
                      <Glyph kind={m.kind} color={c.color} />
                    </span>
                  ))}
              </div>
            ))}

            {/* Incident line across all lanes */}
            {crash && (
              <div className="pointer-events-none absolute inset-y-0 z-0 border-l-2 border-dashed border-accent" style={{ left: `${pos(crash.t) * 100}%` }}>
                <span className="placard absolute -top-0 left-1.5 rounded-[2px] bg-accent px-1 py-px text-[9.5px] text-on-accent">Incident</span>
              </div>
            )}

            {/* Playhead */}
            {(reveal !== undefined || live) && cut < 1 + 1e-9 && (
              <div className="pointer-events-none absolute inset-y-0 z-30 w-px bg-fg" style={{ left: `${cut * 100}%` }}>
                <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-fg" />
              </div>
            )}
          </div>

          {/* Time axis */}
          <div className="placard px-3 pt-1.5 text-[9.5px] text-dim">T+</div>
          <div className="relative h-6">
            {ticks.map((p) => (
              <span key={p} className={cx("absolute top-1.5 font-mono text-[10px] text-dim", p === 0 ? "" : p === 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${p * 100}%` }}>
                {fmtElapsed(p * span)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {caption && <div className="border-t border-line-strong px-3 py-2">{caption(latest)}</div>}
    </div>
  );
}

/** Legend for the glyphs, rendered once beneath a tape. */
export function TapeLegend({ className }: { className?: string }) {
  const items: [MarkKind, string][] = [
    ["pay", "x402 payment"],
    ["reject", "blocked before signing"],
    ["checkpoint", "checkpoint"],
    ["crash", "crash"],
    ["resume", "resumed from checkpoint"],
    ["escrow", "escrow tx"],
    ["settle", "settled"],
  ];
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted", className)}>
      {items.map(([k, l]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="grid w-5 place-items-center">
            <Glyph kind={k} color="var(--fg)" />
          </span>
          {l}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Real events → marks ---------- */

function kindOf(e: EventRow): MarkKind {
  const t = e.type;
  if (t === "worker.crash") return "crash";
  if (t === "lease.expired" || t === "task.stale_attempt") return "warn";
  if (t === "checkpoint.loaded" || t === "worker.resume") return "resume";
  if (t === "checkpoint.saved") return "checkpoint";
  if (t === "payment.confirmed" || t === "payment.reused") return "pay";
  if (t === "payment.blocked" || t === "payment.failed") return "reject";
  if (t === "escrow.settled") return "settle";
  if (t.startsWith("escrow.") && (t === "escrow.confirmed" || t === "escrow.submitted")) return "escrow";
  if (t === "workflow.created" || t === "workflow.approved") return "plan";
  if (t === "workflow.completed") return "done";
  return "step";
}

export function eventsToMarks(events: EventRow[]): TapeMark[] {
  const out: TapeMark[] = [];
  for (const e of events) {
    const kind = kindOf(e);
    const channel: Channel = e.worker_id === "worker-a" ? "worker-a" : e.worker_id === "worker-b" ? "worker-b" : "orch";
    // Escrow transactions are sent by the orchestrator but belong on the chain lane.
    const onChainOnly = kind === "escrow" || kind === "settle";
    if (!onChainOnly) out.push({ id: e.id, t: e.created_at, channel, kind, label: e.message });
    const confirmedOnChain = kind === "pay" || onChainOnly || (typeof e.data?.explorer === "string" && e.level === "success");
    if (confirmedOnChain) out.push({ id: `c${e.id}`, t: e.created_at, channel: "chain", kind: kind === "step" ? "escrow" : kind, label: e.message });
  }
  return out;
}

/* ---------- Landing replay ---------- */

// Offsets (seconds) follow the documented run wf_a4198e6b7d13412b; timing is approximate.
const DEMO: (Omit<TapeMark, "t"> & { s: number })[] = [
  { id: 1, s: 0, channel: "orch", kind: "plan", label: "Plan validated — 3 tasks, budget within policy" },
  { id: 2, s: 5, channel: "chain", kind: "escrow", label: "TaskEscrow.createTask confirmed" },
  { id: 3, s: 8, channel: "chain", kind: "escrow", label: "fundTask — 0.01 MON locked in escrow" },
  { id: 4, s: 12, channel: "worker-a", kind: "step", label: "Worker A claims research task" },
  { id: 5, s: 15, channel: "worker-a", kind: "warn", label: "HTTP 402 Payment Required from paid data API" },
  { id: 6, s: 19, channel: "worker-a", kind: "pay", label: "Policy approved 0.01 USDC — payment settled and verified" },
  { id: 7, s: 19.5, channel: "chain", kind: "pay", label: "USDC Transfer log matched on Monad" },
  { id: 8, s: 23, channel: "worker-a", kind: "checkpoint", label: "Checkpoint cp1 saved: purchase recorded" },
  { id: 9, s: 26, channel: "worker-a", kind: "reject", label: "0.25 USDC request blocked before signing (cap 0.02)" },
  { id: 10, s: 29, channel: "worker-a", kind: "crash", label: "Worker A process killed mid-task" },
  { id: 11, s: 38, channel: "orch", kind: "warn", label: "Lease expired — task reassigned" },
  { id: 12, s: 40, channel: "worker-b", kind: "resume", label: "Worker B resumes from cp1 — data not bought again" },
  { id: 13, s: 46, channel: "worker-b", kind: "checkpoint", label: "Checkpoint cp3: sources gathered" },
  { id: 14, s: 52, channel: "worker-b", kind: "checkpoint", label: "Checkpoint cp5: analysis complete" },
  { id: 15, s: 58, channel: "orch", kind: "done", label: "Briefing passed every verification check" },
  { id: 16, s: 61, channel: "chain", kind: "escrow", label: "submitResult — briefing hash committed by Worker B" },
  { id: 17, s: 66, channel: "chain", kind: "settle", label: "acceptResult — escrow paid to Worker B" },
];

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function TapeReplay() {
  const marks = useMemo<TapeMark[]>(() => DEMO.map(({ s, ...m }) => ({ ...m, t: s * 1000 })), []);
  const [p, setP] = useState(1);
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED).matches, () => false);

  useEffect(() => {
    if (reduced) return;
    const RUN = 11000;
    const HOLD = 2600;
    let t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const el = now - t0;
      if (el > RUN + HOLD) t0 = now;
      setP(Math.min(1, el / RUN));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <RecorderTape
      marks={marks}
      start={0}
      end={70000}
      reveal={reduced ? undefined : p}
      caption={(m) => (
        <div className="flex min-h-5 items-center gap-3 font-mono text-[12px]" aria-live="off">
          <span className="text-dim">{m ? fmtElapsed(m.t) : "00:00"}</span>
          <span className={cx("min-w-0 truncate", m?.kind === "crash" ? "font-semibold text-accent-ink" : m?.kind === "settle" ? "text-ok" : "text-fg")}>{m?.label ?? "Recording…"}</span>
        </div>
      )}
    />
  );
}
