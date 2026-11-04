import Link from "next/link";
import { ExternalLink as ExtIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface/80 backdrop-blur-sm", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, icon, right, sub }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
          {icon && <span className="text-violet">{icon}</span>}
          {title}
        </div>
        {sub && <div className="mt-0.5 text-xs text-dim">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

const tone: Record<string, string> = {
  ok: "border-ok/25 bg-ok/10 text-ok",
  warn: "border-warn/25 bg-warn/10 text-warn",
  bad: "border-bad/25 bg-bad/10 text-bad",
  violet: "border-violet/30 bg-violet/10 text-[#c4b5fd]",
  blue: "border-blue/30 bg-blue/10 text-[#9bb8ff]",
  muted: "border-line-strong bg-white/[0.03] text-muted",
};

export function Badge({ children, t = "muted", className, wrap = false }: { children: ReactNode; t?: keyof typeof tone; className?: string; wrap?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide",
        wrap ? "max-w-full whitespace-normal text-left [overflow-wrap:anywhere]" : "whitespace-nowrap",
        tone[t],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(s: string): keyof typeof tone {
  if (["COMPLETED", "CONFIRMED", "SETTLED", "ONLINE", "SUCCEEDED", "FUNDED", "PAID", "REUSED", "passed"].includes(s)) return "ok";
  if (["FAILED", "REJECTED", "OFFLINE", "CANCELLED", "FIRED"].includes(s)) return "bad";
  if (["RECOVERING", "BLOCKED", "UNKNOWN", "APPROVAL_REQUIRED", "ARMED", "RELEASED", "SETTLING"].includes(s)) return "warn";
  if (["RUNNING", "CLAIMED", "CHECKPOINTED", "VERIFYING", "BUSY", "ACTIVE", "SUBMITTED", "RESERVED", "PENDING", "APPROVED"].includes(s)) return "violet";
  return "muted";
}

export function StatusBadge({ s, className }: { s: string; className?: string }) {
  return (
    <Badge t={statusTone(s)} className={className}>
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

export function Dot({ s }: { s: string }) {
  const t = statusTone(s);
  const color = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", violet: "bg-violet", blue: "bg-blue", muted: "bg-dim" }[t];
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", color, t === "violet" && "pulse-ring")} />;
}

type BtnProps = ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-violet text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_8px_24px_-8px_rgba(139,92,246,0.6)] hover:bg-[#7c4ef0]",
        variant === "ghost" && "text-muted hover:bg-white/5 hover:text-fg",
        variant === "outline" && "border border-line-strong bg-white/[0.02] text-fg hover:bg-white/[0.06]",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
        variant === "primary"
          ? "bg-violet text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.6)] hover:bg-[#7c4ef0]"
          : "border border-line-strong bg-white/[0.02] text-fg hover:bg-white/[0.06]",
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
    <a href={href} target="_blank" rel="noreferrer noopener" className={cx("inline-flex items-center gap-1 text-[#b4a1fb] hover:text-[#d4c8ff]", className)}>
      {children}
      <ExtIcon className="size-3 opacity-70" />
    </a>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12px]", className)}>{children}</span>;
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-1 truncate font-mono text-[15px] text-fg">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-dim">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white", className)} />;
}
