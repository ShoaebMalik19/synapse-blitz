"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  GitBranch,
  Landmark,
  Play,
  RotateCcw,
  ScrollText,
  Skull,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Dag } from "@/components/dag";
import { RecoveryHandoff } from "@/components/handoff";
import { Nav } from "@/components/nav";
import { eventsToMarks, RecorderTape, TapeLegend } from "@/components/tape";
import { deriveStory, StoryStepper } from "@/components/story";
import { Badge, Button, ButtonLink, Card, CardHeader, Empty, ErrorNote, Ext, Mono, Rec, Spinner, Stat, StatusBadge, cx } from "@/components/ui";
import { api, ApiError, clock, fmtMon, fmtUsdc, paymentLabel, plannerLabel, shortHash, type EventRow, type PaymentsResponse, type WorkflowDetail } from "@/lib/client";

const levelColor = { info: "text-muted", warn: "text-warn", error: "text-bad", success: "text-ok" } as const;

/** Events that matter for the demo story; the rest are available behind "all events". */
const KEY_EVENTS = /^(planner\.generated|workflow\.(approved|completed|failed)|escrow\.(confirmed|settled|blocked|failed)|payment\.(confirmed|rejected|blocked|reused|reconciled|failed)|worker\.(crash|resume)|lease\.expired|task\.(recovery_claimed|completed|failed)|checkpoint\.loaded|fault\.armed)$/;

export default function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [pay, setPay] = useState<PaymentsResponse | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [drill, setDrill] = useState(true);
  const [highValue, setHighValue] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [allEvents, setAllEvents] = useState(false);
  const [now, setNow] = useState(0);
  const lastId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [w, p, e] = await Promise.all([
        api<WorkflowDetail>(`/api/workflows/${id}`),
        api<PaymentsResponse>(`/api/workflows/${id}/payments`),
        api<{ events: EventRow[] }>(`/api/workflows/${id}/events?after=${lastId.current}`),
      ]);
      setWf(w);
      setPay(p);
      if (e.events.length) {
        lastId.current = e.events.at(-1)!.id;
        setEvents((prev) => [...prev, ...e.events]);
      }
      setErr(null);
      setNow(Date.now());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.push(`/login?next=/workflows/${id}`);
      else setErr((e as Error).message);
    }
  }, [id, router]);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => (allEvents ? events : events.filter((e) => KEY_EVENTS.test(e.type))), [events, allEvents]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [shown.length]);

  const act = async (name: string, path: string, body?: unknown) => {
    setPending(name);
    setActionErr(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
      await load();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  if (err && !wf) return <Shell><ErrorNote>{err}</ErrorNote></Shell>;
  if (!wf || !pay) return <Shell><div className="flex items-center gap-2 text-dim"><Spinner /> Loading workflow…</div></Shell>;

  const w = wf.workflow;
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(w.status);
  const research = wf.tasks.find((t) => t.capability === "research");
  const canInject = ["APPROVED", "ACTIVE"].includes(w.status) && research && !["COMPLETED", "FAILED"].includes(research.status) && !wf.faults.some((f) => f.status === "ARMED");
  const done = wf.tasks.filter((t) => t.status === "COMPLETED").length;
  const sel = wf.tasks.find((t) => t.taskId === selected) ?? wf.tasks.find((t) => t.currentWorker) ?? null;
  const b = wf.budget.x402;
  const story = deriveStory(wf, pay.payments, pay.escrow);
  const tapeMarks = eventsToMarks(events);

  return (
    <Shell>
      {/* Header + primary action */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-xs text-dim hover:text-fg">
            <ArrowLeft className="size-3" aria-hidden /> Console
          </Link>
          <p className="placard text-dim">Workflow {w.id}</p>
          <h1 className="font-display mt-1 max-w-[40ch] text-[clamp(1.5rem,2.6vw,2.1rem)] font-semibold leading-tight">{w.goal}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-dim">
            <StatusBadge s={w.status} />
            <Badge t={w.plannerSource?.kind === "llm" ? "blue" : "warn"}>planner: {plannerLabel(w.planner, w.plannerSource)}</Badge>
                        <span title={w.planHash}>plan {shortHash(w.planHash, 4)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canInject && (
            <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => act("inject", `/api/workflows/${id}/inject-failure`)}>
              {pending === "inject" ? <Spinner /> : <Skull className="size-3.5" aria-hidden />} Inject Worker Failure
            </Button>
          )}
          {!terminal && (
            <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => act("cancel", `/api/workflows/${id}/cancel`)}>
              <XCircle className="size-3.5" aria-hidden /> Cancel
            </Button>
          )}
          {w.status === "COMPLETED" && w.settlementStatus === "FAILED" && (
            <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => act("settle", `/api/workflows/${id}/settle`)}>
              {pending === "settle" ? <Spinner /> : <RotateCcw className="size-3.5" aria-hidden />} Retry settlement
            </Button>
          )}
          {w.status === "COMPLETED" && (
            <ButtonLink href={`/workflows/${id}/result`}>
              <FileText className="size-4" aria-hidden /> View briefing
            </ButtonLink>
          )}
        </div>
      </div>

      {actionErr && <ErrorNote>{actionErr}</ErrorNote>}

      {/* The story */}
      <section aria-label="Run milestones">
        <StoryStepper steps={story} />
      </section>

      {w.settlementNote && (w.settlementStatus === "BLOCKED" || w.settlementStatus === "FAILED") && (
        <div className="flex items-start gap-2 rounded-[4px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="[overflow-wrap:anywhere]">
            On-chain escrow {w.settlementStatus.toLowerCase()}: {w.settlementNote}
          </span>
        </div>
      )}

      {/* Draft approval: the only path from a draft to execution */}
      {w.status === "APPROVAL_REQUIRED" && (
        <Card className="anim-fade-up border-2 border-accent">
          <CardHeader
            title="Review draft and approve"
            icon={<CheckCircle2 aria-hidden />}
            sub="Nothing has run yet: no workers, no payment signatures, no escrow. Approving starts all three."
          />
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2 rounded-[4px] border border-line-strong bg-bg px-3 py-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-blue" aria-hidden />
                <div>
                  <div className="font-medium">{w.plan.summary}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-dim">
                    {w.plannerSource?.kind === "llm"
                      ? `${w.plannerSource.provider} · ${w.plannerSource.model} · ${w.plannerSource.latencyMs} ms · ${w.plannerSource.usage?.total_tokens ?? "?"} tokens · accepted by DAG validator`
                      : `deterministic rule-based planner${w.plannerSource?.fallbackReason ? ` · fallback: ${w.plannerSource.fallbackReason}` : ""}`}
                  </div>
                </div>
              </div>
              {w.plannerNotes.length > 0 && (
                <div className="rounded-[4px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  {w.plannerNotes.map((n) => (
                    <div key={n} className="[overflow-wrap:anywhere]">{n}</div>
                  ))}
                </div>
              )}
              <ol className="grid gap-1.5 sm:grid-cols-2">
                {wf.tasks.map((t, i) => (
                  <li key={t.taskId} className="rounded-[4px] border border-line-strong bg-bg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                      <Badge t={t.capability === "research" ? "blue" : "ink"}>{t.capability}</Badge>
                      <span className="text-[13px] font-medium">{t.title}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-dim">
                      {t.dependencies.length ? `after ${t.dependencies.join(", ")}` : "starts first"} · ≤{t.maxCost.usdc} USDC · {t.eligibleWorkers.primary.join(", ")}
                      {t.eligibleWorkers.backup.length ? ` (backup ${t.eligibleWorkers.backup.join(", ")})` : ""}
                    </div>
                  </li>
                ))}
              </ol>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                Failure drill: crash Worker A after its first checkpoint
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-muted">
                <input type="checkbox" checked={highValue} onChange={(e) => setHighValue(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                Pre-approve purchases above the approval threshold (still bounded by the per-call cap)
              </label>
              <div className="font-mono text-[11px] text-dim">
                estimated x402 {w.plan.totalEstimatedUsdc} USDC · cap {fmtUsdc(b.capBase)} USDC · escrow {fmtMon(wf.budget.escrow.capWei)} MON · gas ≤ {fmtMon(wf.budget.gas.capWei)} MON
              </div>
            </div>
            <Button className="h-11 px-5" disabled={pending !== null} onClick={() => act("start", `/api/workflows/${id}/start`, { failureDrill: drill, approveHighValue: highValue })}>
              {pending === "start" ? <Spinner /> : <Play className="size-4" aria-hidden />} Approve & start
            </Button>
          </div>
        </Card>
      )}

      {/* Key numbers */}
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line-strong lg:grid-cols-5 [&>*]:bg-surface [&>*]:p-4 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <Stat label="Progress" value={`${done} / ${wf.tasks.length} tasks`} sub={w.status.replace(/_/g, " ")} />
        <Stat label="x402 paid (verified)" value={`${fmtUsdc(b.confirmedBase)} USDC`} sub={`cap ${fmtUsdc(b.capBase)} · est ${fmtUsdc(b.estimatedBase)}`} />
        <Stat label="Not charged" value={`${fmtUsdc((BigInt(b.rejectedBase) + BigInt(b.releasedBase)).toString())} USDC`} sub={`rejected ${fmtUsdc(b.rejectedBase)} · released ${fmtUsdc(b.releasedBase)}`} />
        <Stat label="Escrow" value={`${fmtMon(wf.budget.escrow.capWei)} MON`} sub={w.settlementStatus.replace(/_/g, " ")} />
        <Stat label="Recoveries" value={wf.attempts.filter((a) => a.kind === "RECOVERY").length} sub={`${wf.checkpoints.length} checkpoints · ${wf.faults.filter((f) => f.status === "FIRED").length} faults fired`} />
      </Card>

      {/* Recorder tape: every recorded event, by actor */}
      {w.status !== "APPROVAL_REQUIRED" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <div className="placard text-fg">Recorder tape</div>
              <div className="mt-1 text-xs text-dim">Every recorded event, by actor. Hover a mark for details.</div>
            </div>
            <Rec on={!terminal} label={terminal ? "Recording closed" : "Recording"} />
          </div>
          {events.length ? (
            <RecorderTape
              marks={tapeMarks}
              start={events[0].created_at}
              end={terminal ? Math.max(events.at(-1)!.created_at, events[0].created_at + 1000) : Math.max(now, events.at(-1)!.created_at)}
              live={!terminal}
              caption={(m) => (
                <div className="flex min-h-5 items-center gap-3 font-mono text-[12px]">
                  <span className="text-dim">{m ? clock(m.t) : "--:--:--"}</span>
                  <span className={cx("min-w-0 truncate", m?.kind === "crash" ? "font-semibold text-accent-ink" : m?.kind === "settle" ? "text-ok" : "text-fg")}>{m?.label ?? ""}</span>
                </div>
              )}
            />
          ) : (
            <Empty>The tape starts when the workflow records its first event.</Empty>
          )}
          <TapeLegend className="border-t border-line px-4 py-2.5" />
        </Card>
      )}

      {/* Recovery handoff */}
      {wf.attempts.some((a) => a.kind === "RECOVERY") && (
        <Card>
          <CardHeader title="Recovery handoff" icon={<RotateCcw aria-hidden />} sub="Worker A's process died; Worker B resumed from the persisted checkpoint instead of starting over" />
          <div className="p-4">
            <RecoveryHandoff attempts={wf.attempts} checkpoints={wf.checkpoints} payments={pay.payments} />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Execution DAG" icon={<GitBranch aria-hidden />} sub="Tap a node for details. Active nodes glow; edges animate while work flows." />
          <Dag tasks={wf.tasks} selected={sel?.taskId} onSelect={setSelected} />
          {sel && (
            <div className="border-t border-line p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{sel.title}</span>
                <StatusBadge s={sel.status} />
              </div>
              <div className="mt-1 font-mono text-[11px] text-dim">
                eligible {sel.eligibleWorkers.primary.join(", ")}
                {sel.eligibleWorkers.backup.length ? ` · backup ${sel.eligibleWorkers.backup.join(", ")}` : ""} · retries ≤ {sel.retryLimit} · timeout {sel.timeoutMs / 1000}s
              </div>
              <p className="mt-1.5 text-muted">{sel.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sel.verificationCriteria.map((c) => (
                  <Badge key={c} wrap>
                    {c}
                  </Badge>
                ))}
              </div>
              {sel.error && <p className="mt-2 text-xs text-warn [overflow-wrap:anywhere]">last error: {sel.error}</p>}
              {sel.resultHash && <p className="mt-2 font-mono text-[11px] text-dim [overflow-wrap:anywhere]">result sha256 {sel.resultHash}</p>}
            </div>
          )}
        </Card>

        <Card className="flex min-h-[360px] min-w-0 flex-col">
          <CardHeader
            title="Event log"
            icon={<ScrollText aria-hidden />}
            right={
              <button onClick={() => setAllEvents((v) => !v)} className="cursor-pointer rounded-[3px] border border-line-strong px-2 py-1 font-mono text-[10.5px] text-muted hover:border-fg/40 hover:text-fg" aria-pressed={allEvents}>
                {allEvents ? `key events` : `all ${events.length} events`}
              </button>
            }
          />
          <div ref={logRef} className="max-h-[460px] flex-1 overflow-y-auto px-2 py-2" aria-live="polite" aria-relevant="additions">
            <ol className="relative">
              {shown.map((e) => (
                <li
                  key={e.id}
                  className={cx(
                    "anim-fade-up grid grid-cols-[auto_1fr] gap-x-2 rounded-[3px] px-2 py-1.5 sm:grid-cols-[88px_40px_1fr]",
                    e.type === "worker.crash" && "bg-accent/15 font-medium",
                    e.type === "checkpoint.loaded" && "bg-ok/10",
                    e.type === "payment.confirmed" && "bg-blue/10",
                  )}
                >
                  <span className="font-mono text-[10.5px] text-dim sm:text-[11px]">{clock(e.created_at)}</span>
                  <span className={cx("font-mono text-[10.5px] sm:text-[11px]", e.worker_id === "worker-a" ? "text-blue" : e.worker_id === "worker-b" ? "text-wb" : "text-dim")}>
                    {e.worker_id ? e.worker_id.replace("worker-", "W·") : "orch"}
                  </span>
                  <span className={cx("col-span-2 text-[12.5px] leading-snug [overflow-wrap:anywhere] sm:col-span-1", levelColor[e.level])}>
                    {e.message}
                    {typeof e.data?.explorer === "string" && (
                      <>
                        {" "}
                        <Ext href={e.data.explorer as string}>tx</Ext>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {!shown.length && <Empty>Waiting for events…</Empty>}
          </div>
        </Card>
      </div>

      {/* Ledger */}
      <Card>
        <CardHeader
          title="Payment & settlement ledger"
          icon={<CircleDollarSign aria-hidden />}
          sub="A purchase is shown as paid only after its USDC Transfer log is verified on Monad"
          right={pay.escrowContract ? <Ext href={pay.escrowContract.explorer} className="text-xs">TaskEscrow</Ext> : undefined}
        />
        <ul className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0 md:gap-px md:bg-line">
          {pay.payments.map((p) => {
            const lbl = paymentLabel(p);
            return (
              <li key={p.id} className="bg-surface px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge t="blue">x402</Badge>
                    <span className="truncate font-mono text-xs">{new URL(p.resource_url).pathname}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mono className={lbl.charged ? "" : "text-dim line-through"}>{fmtUsdc(p.amount_base)} USDC</Mono>
                    <Badge t={lbl.tone}>{lbl.label}</Badge>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                  <span>{p.network}</span>
                  <span>payTo {shortHash(p.pay_to, 4)}</span>
                  {p.tx_hash && <Ext href={p.explorer_url}>tx {shortHash(p.tx_hash)}</Ext>}
                  {p.verification?.onchain?.verified && <span className="text-ok">✓ Transfer log @ block {p.verification.onchain.blockNumber}</span>}
                </div>
                {p.status_reason && <div className="mt-1 text-[11px] text-warn [overflow-wrap:anywhere]">{p.status_reason}</div>}
              </li>
            );
          })}
          {pay.escrow.map((e) => (
            <li key={e.id} className="bg-surface px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge t="ink">
                    <Landmark className="size-3" aria-hidden /> escrow
                  </Badge>
                  <span className="font-mono text-xs">{e.action}</span>
                </div>
                <div className="flex items-center gap-2">
                  {e.amount_wei && <Mono>{fmtMon(e.amount_wei)} MON</Mono>}
                  <StatusBadge s={e.status} />
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                <span>task {shortHash(e.onchain_task_id, 4)}</span>
                {e.tx_hash && <Ext href={e.explorer_url}>tx {shortHash(e.tx_hash)}</Ext>}
                {e.block_number && <span>block {e.block_number}</span>}
              </div>
              {e.status_reason && <div className="mt-1 text-[11px] text-warn [overflow-wrap:anywhere]">{e.status_reason}</div>}
            </li>
          ))}
        </ul>
        {!pay.payments.length && !pay.escrow.length && <Empty>No payment or escrow operations yet{w.status === "APPROVAL_REQUIRED" ? " — this is a draft." : "."}</Empty>}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Nav />
      <main id="main" className="mx-auto max-w-[1400px] space-y-5 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
