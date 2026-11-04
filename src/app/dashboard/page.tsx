"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Bot, Brain, ChevronDown, ChevronRight, CircleDollarSign, Cpu, FileText, Link2, PlayCircle, RotateCcw, Server, Sparkles, Wallet } from "lucide-react";
import { Nav } from "@/components/nav";
import { deriveStory, StoryStepper } from "@/components/story";
import { Badge, Button, ButtonLink, Card, CardHeader, Dot, Empty, ErrorNote, Ext, Mono, Spinner, StatusBadge, cx } from "@/components/ui";
import {
  api,
  ApiError,
  bestRun,
  fmtMon,
  fmtUsdc,
  shortHash,
  timeAgo,
  type Budget,
  type NetworkStatus,
  type PaymentsResponse,
  type WorkerInfo,
  type WorkflowDetail,
  type WorkflowListItem,
} from "@/lib/client";

const DEFAULT_GOAL = "Research the Monad ecosystem and generate an actionable technical briefing.";
const EXAMPLES = [
  DEFAULT_GOAL,
  "Assess Monad developer tooling and infrastructure gaps for teams building agent payment products, and recommend what to build first.",
  "Analyze Monad DeFi liquidity concentration and summarize the main risks for a new lending protocol.",
];
const EXPLORER = "https://testnet.monadvision.com/tx/";

function NumberField({ id, label, unit, value, onChange, step, max, hint }: { id: string; label: string; unit: string; value: number; onChange: (n: number) => void; step: number; max: number; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono text-[10.5px] text-dim">max {max}</span>
      </label>
      <div className="flex h-11 items-center rounded-lg border border-line-strong bg-elev focus-within:border-violet/60">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          max={max}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-full w-full min-w-0 bg-transparent px-3 font-mono text-sm outline-none"
        />
        <span className="pr-3 font-mono text-[11px] text-dim">{unit}</span>
      </div>
      {hint && <div className="mt-1 text-[11px] text-dim">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [net, setNet] = useState<NetworkStatus | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [flows, setFlows] = useState<WorkflowListItem[] | null>(null);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [showBudget, setShowBudget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [featured, setFeatured] = useState<{ wf: WorkflowDetail; pay: PaymentsResponse } | null>(null);

  const onErr = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) router.push("/login?next=/dashboard");
    },
    [router],
  );

  const load = useCallback(async () => {
    api<{ workflows: WorkflowListItem[] }>("/api/workflows")
      .then((r) => setFlows(r.workflows))
      .catch(onErr);
    api<{ workers: WorkerInfo[] }>("/api/workers").then((r) => setWorkers(r.workers)).catch(() => null);
  }, [onErr]);

  useEffect(() => {
    api<NetworkStatus>("/api/network/status")
      .then((n) => {
        setNet(n);
        setBudget((b) => b ?? n.policyDefaults);
      })
      .catch((e) => setNetErr(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const best = flows ? bestRun(flows) : null;
  const bestId = best?.id;
  useEffect(() => {
    if (!bestId) return;
    Promise.all([api<WorkflowDetail>(`/api/workflows/${bestId}`), api<PaymentsResponse>(`/api/workflows/${bestId}/payments`)])
      .then(([wf, pay]) => setFeatured({ wf, pay }))
      .catch(() => null);
  }, [bestId]);

  const max = net?.policyDefaults;
  const set = (k: keyof Budget) => (v: number) => setBudget((b) => (b ? { ...b, [k]: v } : b));
  const opMon = net?.operator?.balances?.monWei;
  const opUsdc = net?.operator?.balances?.usdcBase;
  const plannerText = net ? (net.llm.configured ? `${net.llm.provider} · ${net.llm.model}` : "Rule-based planner (no LLM key)") : "…";

  return (
    <div className="min-h-dvh">
      <Nav />
      <main id="main" className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Workflow Studio</h1>
          <p className="mt-1 text-sm text-muted">Describe a research goal. Synapse drafts a plan; nothing runs, pays or settles until you approve it.</p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* Primary action: draft a plan */}
          <Card className="border-violet/30">
            <CardHeader title="New workflow" icon={<Sparkles className="size-4" aria-hidden />} sub="Step 1 of 2 — generate a draft. You review and approve it on the next screen." />
            <form
              className="space-y-4 p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!budget) return;
                setBusy(true);
                setErr(null);
                try {
                  const r = await api<{ id: string }>("/api/workflows", { method: "POST", body: JSON.stringify({ goal, budget }) });
                  router.push(`/workflows/${r.id}`);
                } catch (e) {
                  onErr(e);
                  setErr(e instanceof ApiError ? e.message : "Failed to create the draft — check that the server is running.");
                  setBusy(false);
                }
              }}
            >
              <div>
                <label htmlFor="goal" className="mb-1.5 block text-xs text-muted">
                  Objective
                </label>
                <textarea
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={3}
                  maxLength={500}
                  aria-describedby={err ? "goal-error" : "goal-help"}
                  aria-invalid={Boolean(err)}
                  className="w-full resize-none rounded-lg border border-line-strong bg-elev px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-violet/60"
                />
                <div id="goal-help" className="mt-1.5 flex flex-wrap gap-1.5">
                  {EXAMPLES.map((g, i) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGoal(g)}
                      className={cx("cursor-pointer rounded-md border px-2 py-1 text-[11px] transition-colors", goal === g ? "border-violet/50 bg-violet/10 text-fg" : "border-line text-muted hover:text-fg")}
                    >
                      {["Ecosystem briefing", "Tooling gaps", "DeFi risk"][i]}
                    </button>
                  ))}
                </div>
                {err && (
                  <div id="goal-error" role="alert" className="mt-2">
                    <ErrorNote>{err}</ErrorNote>
                  </div>
                )}
              </div>

              {/* Spending limits: summary first, details on demand */}
              <div className="rounded-lg border border-line bg-white/[0.015]">
                <button
                  type="button"
                  onClick={() => setShowBudget((v) => !v)}
                  aria-expanded={showBudget}
                  aria-controls="budget-panel"
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="text-xs text-muted">Spending limits</span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {budget ? (
                      <>
                        <Badge t="blue">x402 ≤ {budget.x402Usdc} USDC</Badge>
                        <Badge t="blue">{budget.perCallUsdc}/call</Badge>
                        <Badge t="violet">escrow {budget.escrowMon} MON</Badge>
                      </>
                    ) : (
                      <Spinner />
                    )}
                    <ChevronDown className={cx("size-4 text-dim transition-transform", showBudget && "rotate-180")} aria-hidden />
                  </span>
                </button>
                {showBudget && budget && max && (
                  <div id="budget-panel" className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
                    <fieldset className="space-y-3">
                      <legend className="mb-2 flex items-center gap-2 text-xs font-medium">
                        <CircleDollarSign className="size-3.5 text-blue" aria-hidden /> x402 data purchases (USDC)
                      </legend>
                      <NumberField id="b-x402" label="Total x402 budget" unit="USDC" value={budget.x402Usdc} onChange={set("x402Usdc")} step={0.01} max={max.x402Usdc} />
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField id="b-call" label="Per-call cap" unit="USDC" value={budget.perCallUsdc} onChange={set("perCallUsdc")} step={0.005} max={max.perCallUsdc} />
                        <NumberField id="b-appr" label="Approval above" unit="USDC" value={budget.approvalThresholdUsdc} onChange={set("approvalThresholdUsdc")} step={0.005} max={max.approvalThresholdUsdc} />
                      </div>
                    </fieldset>
                    <fieldset className="space-y-3">
                      <legend className="mb-2 flex items-center gap-2 text-xs font-medium">
                        <Link2 className="size-3.5 text-violet" aria-hidden /> Monad escrow & gas (MON)
                      </legend>
                      <NumberField id="b-esc" label="Escrow payout" unit="MON" value={budget.escrowMon} onChange={set("escrowMon")} step={0.001} max={max.escrowMon} hint="Locked in TaskEscrow; paid on the accepted result" />
                      <NumberField id="b-gas" label="Gas allowance" unit="MON" value={budget.gasMon} onChange={set("gasMon")} step={0.01} max={max.gasMon} />
                    </fieldset>
                    <p className="text-[11px] text-dim md:col-span-2">USDC and MON are separate budgets and never converted. Server ceilings cap every field; you can only lower them.</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" className="h-11 px-5" disabled={busy || !budget || goal.trim().length < 10}>
                  {busy ? <Spinner /> : <Brain className="size-4" aria-hidden />} {busy ? `Planning${net?.llm.provider ? ` with ${net.llm.provider}` : ""}…` : "Generate plan"}
                </Button>
                <span className="text-xs text-dim">
                  Planner: <span className={net?.llm.configured ? "text-[#9bb8ff]" : "text-warn"}>{plannerText}</span>
                  {net?.llm.configured && " · validated by DAG checks · rule-based fallback on provider errors"}
                </span>
              </div>
            </form>
          </Card>

          {/* Featured replay of the proven run */}
          <Card className="flex flex-col">
            <CardHeader
              title="Replay the proven run"
              icon={<PlayCircle className="size-4" aria-hidden />}
              sub="Already on Monad testnet — opening it spends nothing"
              right={best ? <StatusBadge s={best.settlement_status === "SETTLED" ? "SETTLED" : best.status} /> : undefined}
            />
            {best && featured?.wf.workflow.id === best.id ? (
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <div className="text-sm font-medium leading-snug">{best.goal}</div>
                  <div className="mt-1 font-mono text-[11px] text-dim">
                    {best.id} · {timeAgo(best.created_at)}
                  </div>
                </div>
                <StoryStepper steps={deriveStory(featured.wf, featured.pay.payments, featured.pay.escrow)} compact />
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  {best.x402_tx && <Ext href={`${EXPLORER}${best.x402_tx}`}>x402 tx {shortHash(best.x402_tx, 4)}</Ext>}
                  {best.settle_tx && <Ext href={`${EXPLORER}${best.settle_tx}`}>escrow payout {shortHash(best.settle_tx, 4)}</Ext>}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <ButtonLink href={`/workflows/${best.id}`}>
                    Open run <ArrowRight className="size-4" aria-hidden />
                  </ButtonLink>
                  <ButtonLink href={`/workflows/${best.id}/result`} variant="outline">
                    <FileText className="size-4" aria-hidden /> Briefing
                  </ButtonLink>
                </div>
              </div>
            ) : flows && !best ? (
              <Empty>No completed run yet. Generate and approve a plan to create one.</Empty>
            ) : (
              <Empty>
                <Spinner />
              </Empty>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader title="Workflow history" icon={<Activity className="size-4" aria-hidden />} sub="Drafts stay here until approved" />
            {flows === null ? (
              <Empty>
                <Spinner />
              </Empty>
            ) : flows.length === 0 ? (
              <Empty>No workflows yet — generate your first plan above.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {flows.map((f) => (
                  <li key={f.id}>
                    <Link href={`/workflows/${f.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]">
                      <Dot s={f.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{f.goal}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
                          <span>{f.id}</span>
                          <span>
                            {f.completed_count}/{f.task_count} tasks
                          </span>
                          <span className={f.planner.startsWith("groq") ? "text-[#9bb8ff]" : ""}>{f.planner}</span>
                          <span>{timeAgo(f.created_at)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {f.status === "APPROVAL_REQUIRED" && <Badge t="warn">draft · awaiting approval</Badge>}
                          {f.confirmed_payments > 0 && <Badge t="ok">x402 paid ×{f.confirmed_payments}</Badge>}
                          {f.recoveries > 0 && (
                            <Badge t="warn">
                              <RotateCcw className="size-3" aria-hidden /> recovered
                            </Badge>
                          )}
                          {f.settlement_status === "SETTLED" && <Badge t="ok">escrow settled</Badge>}
                          {f.status === "COMPLETED" && f.settlement_status !== "SETTLED" && <Badge t="warn">escrow {f.settlement_status.toLowerCase()}</Badge>}
                        </div>
                      </div>
                      <div className="hidden sm:block">
                        <StatusBadge s={f.status} />
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-dim" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Network & wallet" icon={<Wallet className="size-4" aria-hidden />} sub="Server-side testnet operator wallet; keys never reach the browser" />
              <div className="space-y-2.5 p-4 text-sm">
                {netErr && <ErrorNote>{netErr}</ErrorNote>}
                {!net && !netErr && (
                  <div className="flex items-center gap-2 text-dim">
                    <Spinner /> Probing Monad RPC, facilitator and services…
                  </div>
                )}
                {net && (
                  <>
                    <Row label="Chain" ok={net.chain.match}>
                      <Mono>{net.chain.rpcChainId ?? "?"} {net.chain.match ? "= expected" : `≠ ${net.chain.expectedChainId}`}</Mono>
                    </Row>
                    <Row label="Operator" ok={Boolean(net.operator)}>
                      {net.operator ? <Ext href={net.operator.explorer}><Mono>{shortHash(net.operator.address, 4)}</Mono></Ext> : "not configured"}
                    </Row>
                    <Row label="Balances" ok={Boolean(opMon && BigInt(opMon) > 0n && opUsdc && BigInt(opUsdc) > 0n)}>
                      <Mono>
                        {fmtMon(opMon, 3)} MON · {fmtUsdc(opUsdc)} USDC
                      </Mono>
                    </Row>
                    <Row label="TaskEscrow" ok={net.escrow.deployed}>
                      {net.escrow.address ? <Ext href={net.escrow.explorer}><Mono>{shortHash(net.escrow.address, 4)}</Mono></Ext> : <span className="text-warn">not deployed</span>}
                    </Row>
                    <Row label="x402" ok={net.x402.exactSupported && net.x402.service.online}>
                      <span className="text-xs">{net.x402.exactSupported ? `exact @ ${net.x402.network}` : net.x402.facilitatorError ?? "unsupported"}{net.x402.service.online ? " · service up" : " · service down"}</span>
                    </Row>
                    <Row label="Planner" ok={net.llm.configured}>
                      <span className="text-xs">{plannerText}</span>
                    </Row>
                  </>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Workers" icon={<Server className="size-4" aria-hidden />} sub="Prototype allowlist — not a permissionless marketplace" />
              <ul className="divide-y divide-line">
                {workers.map((w) => (
                  <li key={w.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {w.id === "worker-a" ? <Bot className="size-4 text-blue" aria-hidden /> : <Cpu className="size-4 text-violet" aria-hidden />}
                        {w.name}
                      </div>
                      <StatusBadge s={w.status} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {w.capabilities.map((c) => (
                        <Badge key={c} t="violet">
                          {c}
                        </Badge>
                      ))}
                      {w.backupCapabilities.map((c) => (
                        <Badge key={c} t="warn">
                          backup:{c}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                      <span>pid {w.pid ?? "—"}</span>
                      <span>heartbeat {timeAgo(w.lastHeartbeat)}</span>
                    </div>
                  </li>
                ))}
                {!workers.length && <Empty>Loading workers…</Empty>}
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-xs text-muted">
        <span className={cx("size-1.5 rounded-full", ok ? "bg-ok" : "bg-warn")} aria-hidden />
        {label}
        <span className="sr-only">{ok ? "ok" : "attention"}</span>
      </span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}
