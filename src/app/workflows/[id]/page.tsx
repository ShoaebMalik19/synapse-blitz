"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  GitBranch,
  History,
  Landmark,
  ListTree,
  Play,
  RotateCcw,
  ScrollText,
  Skull,
  XCircle,
} from "lucide-react";
import { Dag } from "@/components/dag";
import { eventsToMarks, RecorderTape, TapeLegend } from "@/components/tape";
import { Nav } from "@/components/nav";
import { Badge, Button, ButtonLink, Card, CardHeader, Dot, Empty, ErrorNote, Ext, Mono, Rec, Spinner, Stat, StatusBadge, cx } from "@/components/ui";
import { api, ApiError, clock, fmtMon, fmtUsdc, paymentLabel, plannerLabel, shortHash, type EventRow, type PaymentsResponse, type WorkflowDetail } from "@/lib/client";

const levelColor = { info: "text-muted", warn: "text-warn", error: "text-bad", success: "text-ok" } as const;

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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

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
  if (!wf) return <Shell><div className="flex items-center gap-2 text-dim"><Spinner /> Loading workflow…</div></Shell>;

  const w = wf.workflow;
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(w.status);
  const research = wf.tasks.find((t) => t.capability === "research");
  const canInject = ["APPROVED", "ACTIVE"].includes(w.status) && research && !["COMPLETED", "FAILED"].includes(research.status) && !wf.faults.some((f) => f.status === "ARMED");
  const done = wf.tasks.filter((t) => t.status === "COMPLETED").length;
  const sel = wf.tasks.find((t) => t.taskId === selected) ?? wf.tasks.find((t) => t.currentWorker) ?? null;
  const b = wf.budget.x402;
  const tapeMarks = eventsToMarks(events);

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1 text-xs text-dim hover:text-fg">
            <ArrowLeft className="size-3" /> Dashboard
          </Link>
          <p className="placard text-dim">Workflow {w.id}</p>
          <h1 className="font-display mt-1 max-w-[40ch] text-[clamp(1.5rem,2.6vw,2.1rem)] font-semibold leading-tight">{w.goal}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-dim">
            <StatusBadge s={w.status} />
            <Badge t={w.settlementStatus === "SETTLED" ? "ok" : w.settlementStatus === "BLOCKED" || w.settlementStatus === "FAILED" ? "warn" : "muted"}>escrow {w.settlementStatus.replace(/_/g, " ")}</Badge>
            <span>{w.id}</span>
            <Badge t={w.plannerSource?.kind === "llm" ? "blue" : "warn"}>planner: {plannerLabel(w.planner, w.plannerSource)}</Badge>
            <span title={w.planHash}>plan {shortHash(w.planHash, 4)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canInject && (
            <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => act("inject", `/api/workflows/${id}/inject-failure`)}>
              {pending === "inject" ? <Spinner /> : <Skull className="size-3.5" />} Inject Worker Failure
            </Button>
          )}
          {!terminal && (
            <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => act("cancel", `/api/workflows/${id}/cancel`)}>
              <XCircle className="size-3.5" /> Cancel
            </Button>
          )}
          {w.status === "COMPLETED" && w.settlementStatus === "FAILED" && (
            <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => act("settle", `/api/workflows/${id}/settle`)}>
              {pending === "settle" ? <Spinner /> : <RotateCcw className="size-3.5" />} Retry settlement
            </Button>
          )}
          {w.status === "COMPLETED" && (
            <ButtonLink href={`/workflows/${id}/result`} className="h-8 px-3 text-xs">
              <FileText className="size-3.5" /> View briefing
            </ButtonLink>
          )}
        </div>
      </div>

      {actionErr && <ErrorNote>{actionErr}</ErrorNote>}
      {w.settlementNote && (w.settlementStatus === "BLOCKED" || w.settlementStatus === "FAILED") && (
        <div className="flex items-start gap-2 rounded-[4px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            On-chain escrow {w.settlementStatus.toLowerCase()}: {w.settlementNote}
          </span>
        </div>
      )}

      {w.plannerNotes.length > 0 && w.status === "APPROVAL_REQUIRED" && (
        <div className="rounded-[4px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {w.plannerNotes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
      {w.status === "APPROVAL_REQUIRED" && (
        <Card className="border-2 border-accent">
          <CardHeader title="Approve plan & budget" icon={<CheckCircle2 className="size-4" />} sub={w.plan.summary} />
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} className="accent-[var(--accent)]" />
                Failure drill: crash Worker A after its first checkpoint
              </label>
              <label className="flex items-center gap-2 text-muted">
                <input type="checkbox" checked={highValue} onChange={(e) => setHighValue(e.target.checked)} className="accent-[var(--accent)]" />
                Pre-approve purchases above the approval threshold (still bounded by per-call cap)
              </label>
              <div className="font-mono text-[11px] text-dim">
                estimated x402: {w.plan.totalEstimatedUsdc} USDC · cap {fmtUsdc(b.capBase)} USDC · escrow {fmtMon(wf.budget.escrow.capWei)} MON · gas ≤ {fmtMon(wf.budget.gas.capWei)} MON
              </div>
            </div>
            <Button disabled={pending !== null} onClick={() => act("start", `/api/workflows/${id}/start`, { failureDrill: drill, approveHighValue: highValue })}>
              {pending === "start" ? <Spinner /> : <Play className="size-4" />} Approve & start
            </Button>
          </div>
        </Card>
      )}

      <Card className="grid gap-px overflow-hidden bg-line-strong sm:grid-cols-2 lg:grid-cols-5 [&>*]:bg-surface [&>*]:p-4 sm:[&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <Stat label="Progress" value={`${done} / ${wf.tasks.length} tasks`} sub={w.status.replace(/_/g, " ")} />
        <Stat label="Data paid (x402)" value={`${fmtUsdc(b.confirmedBase)} USDC`} sub={`cap ${fmtUsdc(b.capBase)} · est ${fmtUsdc(b.estimatedBase)}`} />
        <Stat label="Blocked by policy" value={`${fmtUsdc(b.rejectedBase)} USDC`} sub={`reserved ${fmtUsdc(b.reservedBase)} · unknown ${fmtUsdc(b.unknownBase)}`} />
        <Stat label="Escrow" value={`${fmtMon(wf.budget.escrow.capWei)} MON`} sub={w.settlementStatus.replace(/_/g, " ")} />
        <Stat label="Recoveries" value={wf.attempts.filter((a) => a.kind === "RECOVERY").length} sub={`${wf.checkpoints.length} checkpoints · ${wf.faults.filter((f) => f.status === "FIRED").length} faults fired`} />
      </Card>

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

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Execution DAG" icon={<GitBranch className="size-4" />} sub="Click a node for details. Edges animate while downstream work runs." />
          <Dag tasks={wf.tasks} selected={sel?.taskId} onSelect={setSelected} />
          {sel && (
            <div className="border-t border-line p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{sel.title}</span>
                <StatusBadge s={sel.status} />
                <span className="font-mono text-[11px] text-dim">
                  eligible {sel.eligibleWorkers.primary.join(", ")}
                  {sel.eligibleWorkers.backup.length ? ` · backup ${sel.eligibleWorkers.backup.join(", ")}` : ""} · retries ≤ {sel.retryLimit} · timeout {sel.timeoutMs / 1000}s
                </span>
              </div>
              <p className="mt-1.5 text-muted">{sel.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sel.verificationCriteria.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </div>
              {sel.error && <p className="mt-2 text-xs text-warn">last error: {sel.error}</p>}
              {sel.resultHash && <p className="mt-2 font-mono text-[11px] text-dim">result sha256 {sel.resultHash}</p>}
            </div>
          )}
        </Card>

        <Card className="flex min-h-[360px] flex-col">
          <CardHeader title="Event log" icon={<ScrollText className="size-4" />} right={<span className="font-mono text-[10px] text-dim">{events.length} events</span>} />
          <div ref={logRef} className="max-h-[440px] flex-1 space-y-0 overflow-y-auto px-2 py-2 font-mono text-[11.5px]">
            {events.map((e) => (
              <div key={e.id} className={cx("flex gap-2 rounded px-2 py-1 hover:bg-fg/[0.04]", e.type === "worker.crash" && "bg-accent/15 font-medium text-fg", e.type.startsWith("checkpoint.loaded") && "bg-ok/10")}>
                <span className="shrink-0 text-dim">{clock(e.created_at)}</span>
                <span className={cx("shrink-0", e.worker_id === "worker-a" ? "text-blue" : e.worker_id === "worker-b" ? "text-wb" : "text-dim")}>{e.worker_id ? e.worker_id.replace("worker-", "W·") : "orch"}</span>
                <span className={cx("min-w-0 break-words", levelColor[e.level])}>
                  {e.message}
                  {typeof e.data?.explorer === "string" && (
                    <>
                      {" "}
                      <Ext href={e.data.explorer as string}>tx</Ext>
                    </>
                  )}
                </span>
              </div>
            ))}
            {!events.length && <Empty>Waiting for events…</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recovery timeline" icon={<History className="size-4" />} sub="Attempts, leases and checkpoints per task" />
          <div className="space-y-4 p-4">
            {wf.tasks.map((t) => {
              const atts = wf.attempts.filter((a) => a.task_id === t.taskId);
              const cps = wf.checkpoints.filter((c) => c.task_id === t.taskId);
              if (!atts.length) return null;
              return (
                <div key={t.taskId}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                    <ListTree className="size-3.5" /> {t.title}
                  </div>
                  <ol className="relative space-y-2 border-l border-line pl-4">
                    {atts.map((a) => (
                      <li key={a.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5"><Dot s={a.status === "RUNNING" ? "RUNNING" : a.status === "SUCCEEDED" ? "COMPLETED" : "FAILED"} /></span>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono text-xs">#{a.attempt_no}</span>
                          <Badge t={a.kind === "RECOVERY" ? "warn" : "muted"}>{a.kind}</Badge>
                          <span className={a.worker_id === "worker-a" ? "text-blue" : "text-wb"}>{a.worker_id}</span>
                          <StatusBadge s={a.status} />
                          <span className="font-mono text-[10.5px] text-dim">{clock(a.started_at)}{a.ended_at ? ` → ${clock(a.ended_at)}` : ""}</span>
                        </div>
                        {a.resumed_from_checkpoint && (
                          <div className="mt-0.5 font-mono text-[11px] text-ok">resumed from {a.resumed_from_checkpoint} (seq {cps.find((c) => c.id === a.resumed_from_checkpoint)?.seq})</div>
                        )}
                        {a.failure_reason && <div className="mt-0.5 text-[11px] text-bad">{a.failure_reason}</div>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {cps
                            .filter((c) => wf.attempts.find((x) => x.id === a.id) && c.worker_id === a.worker_id && c.created_at >= a.started_at && (!a.ended_at || c.created_at <= a.ended_at + 1))
                            .map((c) => (
                              <span key={c.id} title={`state hash ${c.state_hash}`} className="rounded border border-line bg-elev px-1.5 py-0.5 font-mono text-[10px] text-dim">
                                cp{c.seq}: {JSON.parse(c.completed_steps_json).at(-1)}
                                {(() => { const n = JSON.parse(c.payment_op_ids_json).length; return n ? ` · ${n} pay op${n > 1 ? "s" : ""} recorded` : ""; })()}
                              </span>
                            ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
            {!wf.attempts.length && <Empty>No attempts yet.</Empty>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment & settlement ledger" icon={<CircleDollarSign className="size-4" />} sub="Status comes from chain verification, not provider claims" right={pay?.escrowContract ? <Ext href={pay.escrowContract.explorer} className="text-xs">TaskEscrow</Ext> : undefined} />
          <div className="divide-y divide-line">
            {pay?.payments.map((p) => (
              <div key={p.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge t="blue">x402</Badge>
                    <span className="font-mono text-xs">{new URL(p.resource_url).pathname}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mono className={paymentLabel(p).charged ? "" : "text-dim line-through"}>{fmtUsdc(p.amount_base)} USDC</Mono>
                    <Badge t={paymentLabel(p).tone}>{paymentLabel(p).label}</Badge>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                  <span>{p.network}</span>
                  <span>payTo {shortHash(p.pay_to, 4)}</span>
                  {p.tx_hash && <Ext href={p.explorer_url}>tx {shortHash(p.tx_hash)}</Ext>}
                  {p.verification?.onchain?.verified && <span className="text-ok">✓ Transfer log verified @ block {p.verification.onchain.blockNumber}</span>}
                </div>
                {p.status_reason && <div className="mt-1 text-[11px] text-warn">{p.status_reason}</div>}
              </div>
            ))}
            {pay?.escrow.map((e) => (
              <div key={e.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge t="ink">
                      <Landmark className="size-3" /> escrow
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
                {e.status_reason && <div className="mt-1 text-[11px] text-warn">{e.status_reason}</div>}
              </div>
            ))}
            {pay && !pay.payments.length && !pay.escrow.length && <Empty>No payment or escrow operations yet.</Empty>}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
