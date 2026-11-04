import Link from "next/link";
import { ExternalLink as ExtIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- Surfaces ---------- */

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-md border border-line-strong bg-surface shadow-[var(--shadow)]", className)} {...rest}>
      {children}
    </div>
  );
}

/** Panel header styled like an instrument placard: mono caps title, plain-language subtitle. */
export function CardHeader({ title, icon, right, sub }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <div className="placard flex items-center gap-2 text-fg">
          {icon && <span className="text-dim [&_svg]:size-3.5">{icon}</span>}
          {title}
        </div>
        {sub && <div className="mt-1 text-xs leading-snug text-dim">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("placard text-dim", className)}>{children}</div>;
}

/* ---------- Status ---------- */

const tone = {
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  bad: "border-bad/35 bg-bad/10 text-bad",
  blue: "border-blue/35 bg-blue/10 text-blue",
  ink: "border-line-strong bg-fg/[0.06] text-fg",
  accent: "border-accent bg-accent text-on-accent",
  muted: "border-line-strong bg-transparent text-muted",
} as const;
export type Tone = keyof typeof tone;

export function Badge({ children, t = "muted", className, wrap = false }: { children: ReactNode; t?: Tone; className?: string; wrap?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide",
        wrap ? "max-w-full whitespace-normal text-left [overflow-wrap:anywhere]" : "whitespace-nowrap",
        tone[t],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(s: string): Tone {
  if (["COMPLETED", "CONFIRMED", "SETTLED", "ONLINE", "SUCCEEDED", "FUNDED", "PAID", "REUSED", "passed"].includes(s)) return "ok";
  if (["FAILED", "REJECTED", "OFFLINE", "CANCELLED", "FIRED"].includes(s)) return "bad";
  if (["RECOVERING", "BLOCKED", "UNKNOWN", "APPROVAL_REQUIRED", "ARMED", "RELEASED", "SETTLING"].includes(s)) return "warn";
  if (["RUNNING", "CLAIMED", "CHECKPOINTED", "VERIFYING", "BUSY", "ACTIVE", "SUBMITTED", "RESERVED", "PENDING", "APPROVED"].includes(s)) return "blue";
  return "muted";
}

export function StatusBadge({ s, className }: { s: string; className?: string }) {
  return (
    <Badge t={statusTone(s)} className={className}>
      {statusTone(s) === "blue" && <span className="rec inline-block size-1.5 bg-current" aria-hidden />}
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

/** Status light. Live states render as a blinking REC square; others as a steady dot. */
export function Dot({ s }: { s: string }) {
  const t = statusTone(s);
  const color = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", blue: "bg-blue", ink: "bg-fg", accent: "bg-accent", muted: "bg-dim" }[t];
  if (t === "blue") return <span className={cx("rec inline-block size-2 shrink-0", color)} aria-hidden />;
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", color)} aria-hidden />;
}

/** "REC" indicator shown while a workflow is executing. */
export function Rec({ on = true, label = "REC" }: { on?: boolean; label?: string }) {
  return (
    <span className={cx("placard inline-flex items-center gap-1.5", on ? "text-accent-ink" : "text-dim")}>
      <span className={cx("inline-block size-2 rounded-full", on ? "rec bg-accent" : "bg-dim")} aria-hidden />
      {label}
    </span>
  );
}

/* ---------- Instruments ---------- */

/**
 * Budget envelope gauge. Shows spend against a cap, with optional tick marks
 * (e.g. per-call cap, approval threshold) and a rejected overflow segment.
 */
export function Meter({
  value,
  max,
  ticks = [],
  rejected = 0,
  unit,
  label,
}: {
  value: number;
  max: number;
  ticks?: { at: number; label: string }[];
  rejected?: number;
  unit: string;
  label: string;
}) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, max > 0 ? (n / max) * 100 : 0))}%`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="placard text-dim">{label}</span>
        <span className="font-mono text-[12px] text-fg">
          {value} <span className="text-dim">/ {max} {unit}</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-[2px] border border-line-strong bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="absolute inset-y-0 left-0 bg-fg" style={{ width: pct(value) }} />
        {rejected > 0 && <div className="absolute inset-y-0 bg-[repeating-linear-gradient(-45deg,var(--red)_0_3px,transparent_3px_6px)] opacity-70" style={{ left: pct(value), width: pct(rejected) }} />}
        {ticks.map((t) => (
          <div key={t.label} className="absolute -inset-y-1 w-px bg-accent-ink" style={{ left: pct(t.at) }} title={`${t.label}: ${t.at} ${unit}`} />
        ))}
      </div>
      {ticks.length > 0 && (
        <div className="relative mt-1 h-4">
          {ticks.map((t) => (
            <span key={t.label} className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-accent-ink" style={{ left: pct(t.at) }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small ECG-style trace: animated while the worker is online, flat when it isn't. */
export function Heartbeat({ online, className }: { online: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 120 24" className={cx("h-6 w-full", className)} aria-hidden preserveAspectRatio="none">
      {online ? (
        <path className="trace" d="M0 12h30l4-8 5 16 5-14 3 6h22l4-8 5 16 5-14 3 6h29" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinejoin="round" />
      ) : (
        <path d="M0 12h120" fill="none" stroke="var(--red)" strokeWidth="1.5" strokeDasharray="3 3" />
      )}
    </svg>
  );
}

/* ---------- Actions ---------- */

type BtnProps = ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[4px] font-medium transition-[background-color,transform,border-color] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent font-semibold text-on-accent shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] hover:brightness-95",
        variant === "ghost" && "text-muted hover:bg-fg/[0.06] hover:text-fg",
        variant === "outline" && "border border-line-strong bg-surface text-fg hover:border-fg/40 hover:bg-fg/[0.03]",
        variant === "danger" && "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/15",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "outline"; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[4px] px-4 text-sm font-medium transition-[background-color,border-color,filter]",
        variant === "primary"
          ? "bg-accent font-semibold text-on-accent shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] hover:brightness-95"
          : "border border-line-strong bg-surface text-fg hover:border-fg/40 hover:bg-fg/[0.03]",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Ext({ href, children, className }: { href?: string | null; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cx("inline-flex items-center gap-1 text-fg underline decoration-accent decoration-[1.5px] underline-offset-[3px] hover:text-accent-ink", className)}
    >
      {children}
      <ExtIcon className="size-3 opacity-60" aria-hidden />
    </a>
  );
}

/* ---------- Text ---------- */

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12px]", className)}>{children}</span>;
}

/** Instrument readout: placard label, large mono value, small context line. */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="placard text-dim">{label}</div>
      <div className="mt-1.5 truncate font-mono text-[17px] font-medium tracking-tight text-fg">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-dim">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-[4px] border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current", className)} />;
}
