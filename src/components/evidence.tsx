import { Check, Minus, X } from "lucide-react";
import { Ext, cx } from "./ui";

export interface EvidenceStep {
  label: string;
  value?: string | null;
  state: "ok" | "bad" | "pending";
  detail?: string;
  href?: string | null;
  /** Whether this step's value equals the previous step's value (draws "=" on the link). */
  matchesPrev?: boolean | null;
}

const short = (h?: string | null) => (!h ? "—" : h.length > 24 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

/**
 * Proof chain: each link is a piece of evidence; an "=" between links means
 * the two hashes are byte-for-byte identical. Status is shown by icon and text, not color alone.
 */
export function EvidenceChain({ steps }: { steps: EvidenceStep[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.label} className="relative pb-1 last:pb-0">
          {i > 0 && (
            <div className="flex h-6 items-center pl-[11px]" aria-hidden={s.matchesPrev == null}>
              <span className={cx("h-full border-l-2", s.matchesPrev === false ? "border-bad" : "border-line-strong")} />
              {s.matchesPrev != null && (
                <span className={cx("ml-3 font-mono text-[10.5px]", s.matchesPrev ? "text-ok" : "text-bad")}>
                  {s.matchesPrev ? "= identical hash" : "≠ hash mismatch"}
                </span>
              )}
            </div>
          )}
          <div className="flex items-start gap-3">
            <span
              className={cx(
                "grid size-6 shrink-0 place-items-center rounded-[3px] border-2",
                s.state === "ok" && "border-ok bg-ok text-surface",
                s.state === "bad" && "border-bad bg-bad text-surface",
                s.state === "pending" && "border-line-strong text-dim",
              )}
            >
              {s.state === "ok" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "bad" ? <X className="size-3.5" strokeWidth={3} /> : <Minus className="size-3.5" />}
              <span className="sr-only">{s.state === "ok" ? "verified" : s.state === "bad" ? "failed" : "pending"}</span>
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="placard text-fg">{s.label}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-muted">{s.href ? <Ext href={s.href}>{short(s.value)}</Ext> : short(s.value)}</div>
              {s.detail && <div className="mt-0.5 text-[11px] text-dim">{s.detail}</div>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
