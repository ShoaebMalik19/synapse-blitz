"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Brain, Check, ChevronDown, ChevronRight, CircleDollarSign, ClipboardCheck, FileText, History, Landmark, PenLine, PlayCircle, RotateCcw, Server, TriangleAlert } from "lucide-react";
import { Nav } from "@/components/nav";
import { deriveStory, StoryStepper } from "@/components/story";
import { Badge, Button, ButtonLink, Card, CardHeader, Dot, Empty, ErrorNote, Ext, Heartbeat, Meter, Mono, Spinner, StatusBadge, cx } from "@/components/ui";
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
      <label htmlFor={id} className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
        <span>{label}</span>
        <span className="font-mono text-[10.5px] text-dim">max {max}</span>
      </label>
      <div className="flex h-11 items-center rounded-[4px] border border-line-strong bg-field focus-within:border-fg">
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
  const checks = net
    ? [
        { label: "Chain", ok: net.chain.match, value: <Mono>{`${net.chain.rpcChainId ?? "?"} ${net.chain.match ? "· expected" : `≠ ${net.chain.expectedChainId}`}`}</Mono>, sub: `block ${net.chain.blockNumber ?? "?"}` },
        {
          label: "Operator wallet",
          ok: Boolean(net.operator),
          value: net.operator ? <Ext href={net.operator.explorer}><Mono>{shortHash(net.operator.address, 4)}</Mono></Ext> : "Not configured",
          sub: net.operator ? undefined : "Set OPERATOR_PRIVATE_KEY in .env",
        },
        { label: "MON for escrow + gas", ok: Boolean(opMon && BigInt(opMon) > 0n), value: <Mono>{fmtMon(opMon, 3)} MON</Mono>, sub: opMon === "0" ? "Get MON at faucet.monad.xyz" : undefined },
        { label: "USDC for data", ok: Boolean(opUsdc && BigInt(opUsdc) > 0n), value: <Mono>{fmtUsdc(opUsdc)} USDC</Mono>, sub: opUsdc === "0" ? "Get USDC at faucet.circle.com" : undefined },
        {
          label: "TaskEscrow contract",
          ok: net.escrow.deployed,
          value: net.escrow.address ? <Ext href={net.escrow.explorer}><Mono>{shortHash(net.escrow.address, 4)}</Mono></Ext> : "Not deployed",
          sub: net.escrow.deployed ? undefined : "Run npm run deploy:escrow",
        },
        { label: "x402 facilitator", ok: net.x402.exactSupported, value: <span className="text-xs">{net.x402.exactSupported ? `exact @ ${net.x402.network}` : "Unavailable"}</span>, sub: net.x402.facilitatorError ?? undefined },
        { label: "Paid data service", ok: net.x402.service.online, value: <Mono>{net.x402.service.url.replace(/^https?:\/\//, "")}</Mono>, sub: net.x402.service.online ? undefined : "Start it with npm run service" },
      ]
    : [];
  const failing = checks.filter((c) => !c.ok).length;
  const go = net && failing === 0;
  const online = workers.filter((w) => w.status === "ONLINE" || w.status === "BUSY").length;

  return (
    <div className="min-h-dvh">
      <Nav />
      <main id="main" className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="placard text-dim">Operator console</p>
            <h1 className="font-display mt-1 text-[clamp(1.9rem,3.2vw,2.6rem)] font-semibold leading-none">File a flight plan</h1>
            <p className="mt-2 max-w-[60ch] text-sm text-muted">Describe a research goal. Synapse drafts a plan; nothing runs, pays or settles until you approve it.</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#preflight"
              className={cx("placard inline-flex items-center gap-2 rounded-[3px] border-2 px-3 py-1.5", !net ? "border-line-strong text-dim" : go ? "border-ok text-ok" : "border-warn text-warn")}
            >
              {!net ? <Spinner /> : go ? <Check className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
              Preflight {!net ? "…" : go ? "GO" : `NO-GO · ${failing}`}
            </a>
            <span className="placard inline-flex items-center gap-2 rounded-[3px] border-2 border-line-strong px-3 py-1.5 text-muted">
              Workers {online}/{workers.length || 2}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* Primary action: draft a plan */}
          <Card className="border-2 border-fg">
            <CardHeader title="New workflow" icon={<PenLine aria-hidden />} sub="Step 1 of 2 — generate a draft. You review and approve it on the next screen." />
            <form
              className="space-y-5 p-5"
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
                <label htmlFor="goal" className="mb-1.5 block text-xs font-medium text-muted">
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
                  className="w-full resize-none rounded-[4px] border border-line-strong bg-field px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-fg"
                />
                <div id="goal-help" className="mt-1.5 flex flex-wrap gap-1.5">
                  {EXAMPLES.map((g, i) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGoal(g)}
                      aria-pressed={goal === g}
                      className={cx("cursor-pointer rounded-[3px] border px-2.5 py-1.5 text-[11.5px] transition-colors", goal === g ? "border-fg bg-fg text-bg" : "border-line-strong text-muted hover:border-fg/40 hover:text-fg")}
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
              <div className="rounded-[4px] border border-line-strong bg-bg">
                <button
                  type="button"
                  onClick={() => setShowBudget((v) => !v)}
                  aria-expanded={showBudget}
                  aria-controls="budget-panel"
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="placard text-fg">Spending limits</span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {budget ? (
                      <>
                        <Badge t="blue">x402 ≤ {budget.x402Usdc} USDC</Badge>
                        <Badge t="blue">{budget.perCallUsdc}/call</Badge>
                        <Badge t="ink">escrow {budget.escrowMon} MON</Badge>
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
                      <legend className="placard mb-2 flex items-center gap-2 text-fg">
                        <CircleDollarSign className="size-3.5 text-blue" aria-hidden /> x402 data purchases (USDC)
                      </legend>
                      <NumberField id="b-x402" label="Total x402 budget" unit="USDC" value={budget.x402Usdc} onChange={set("x402Usdc")} step={0.01} max={max.x402Usdc} />
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField id="b-call" label="Per-call cap" unit="USDC" value={budget.perCallUsdc} onChange={set("perCallUsdc")} step={0.005} max={max.perCallUsdc} />
                        <NumberField id="b-appr" label="Approval above" unit="USDC" value={budget.approvalThresholdUsdc} onChange={set("approvalThresholdUsdc")} step={0.005} max={max.approvalThresholdUsdc} />
                      </div>
                    </fieldset>
                    <fieldset className="space-y-3">
                      <legend className="placard mb-2 flex items-center gap-2 text-fg">
                        <Landmark className="size-3.5 text-accent-ink" aria-hidden /> Monad escrow & gas (MON)
                      </legend>
                      <NumberField id="b-esc" label="Escrow payout" unit="MON" value={budget.escrowMon} onChange={set("escrowMon")} step={0.001} max={max.escrowMon} hint="Locked in TaskEscrow; paid on the accepted result" />
                      <NumberField id="b-gas" label="Gas allowance" unit="MON" value={budget.gasMon} onChange={set("gasMon")} step={0.01} max={max.gasMon} />
                    </fieldset>
                    <div className="border-t border-dashed border-line-strong pt-3 md:col-span-2">
                      <Meter
                        label="Spending envelope"
                        value={0}
                        max={budget.x402Usdc || 1}
                        unit="USDC"
                        ticks={[
                          { at: budget.approvalThresholdUsdc, label: "ask" },
                          { at: budget.perCallUsdc, label: "cap" },
                        ].filter((t) => t.at > 0 && t.at <= budget.x402Usdc)}
                      />
                      <p className="text-[11px] leading-relaxed text-dim">
                        You are asked to approve above “ask”; any single purchase above “cap” is refused before signing. USDC and MON are separate budgets and never converted. Server ceilings cap every field; you can only lower them.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
                <Button type="submit" className="h-11 px-5" disabled={busy || !budget || goal.trim().length < 10}>
                  {busy ? <Spinner /> : <Brain className="size-4" aria-hidden />} {busy ? `Planning${net?.llm.provider ? ` with ${net.llm.provider}` : ""}…` : "Generate plan"}
                </Button>
                <span className="text-xs text-dim">
                  Planner: <span className={net?.llm.configured ? "text-blue" : "text-warn"}>{plannerText}</span>
                  {net?.llm.configured && " · validated by DAG checks · rule-based fallback on provider errors"}
                </span>
              </div>
            </form>
          </Card>

          {/* Featured replay of the proven run */}
          <Card className="flex flex-col">
            <CardHeader
              title="Replay the proven run"
              icon={<PlayCircle aria-hidden />}
              sub="Already on Monad testnet — opening it spends nothing"
              right={best ? <StatusBadge s={best.settlement_status === "SETTLED" ? "SETTLED" : best.status} /> : undefined}
            />
            {best && featured?.wf.workflow.id === best.id ? (
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <div className="text-[15px] font-semibold leading-snug">{best.goal}</div>
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
              <div className="flex flex-1 flex-col items-start justify-center gap-2 px-5 py-10">
                <p className="font-display text-xl font-semibold">No recorded run yet</p>
                <p className="max-w-[42ch] text-sm text-muted">Generate and approve a plan with the failure drill on. Your first completed run shows up here, ready to replay for judges.</p>
              </div>
            ) : (
              <Empty>
                <Spinner />
              </Empty>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader title="Flight log" icon={<History aria-hidden />} sub="Every workflow, newest first. Drafts stay here until approved." />
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
                    <Link href={`/workflows/${f.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.03]">
                      <Dot s={f.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{f.goal}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
                          <span>{f.id}</span>
                          <span>
                            {f.completed_count}/{f.task_count} tasks
                          </span>
                          <span className={f.planner.startsWith("groq") ? "text-blue" : ""}>{f.planner}</span>
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
                      <ChevronRight className="size-4 shrink-0 text-dim transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-5">
            <Card id="preflight" className="scroll-mt-20">
              <CardHeader title="Preflight checklist" icon={<ClipboardCheck aria-hidden />} sub="Signing keys stay on the server and never reach the browser." />
              <div className="p-2">
                {netErr && (
                  <div className="p-2">
                    <ErrorNote>{netErr}</ErrorNote>
                  </div>
                )}
                {!net && !netErr && (
                  <div className="flex items-center gap-2 p-3 text-sm text-dim">
                    <Spinner /> Checking Monad RPC, facilitator and services…
                  </div>
                )}
                <ul>
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-start justify-between gap-3 rounded-[3px] px-2 py-2.5 hover:bg-fg/[0.03]">
                      <span className="flex items-start gap-2.5">
                        <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-[2px] border", c.ok ? "border-ok bg-ok text-surface" : "border-warn text-warn")} aria-hidden>
                          {c.ok ? <Check className="size-3" strokeWidth={3} /> : <span className="text-[10px] font-bold leading-none">!</span>}
                        </span>
                        <span>
                          <span className="block text-[13px] font-medium">
                            {c.label}
                            <span className="sr-only">{c.ok ? " — passed" : " — needs attention"}</span>
                          </span>
                          {c.sub && <span className={cx("block text-[11px]", c.ok ? "text-dim" : "text-warn")}>{c.sub}</span>}
                        </span>
                      </span>
                      <span className="min-w-0 truncate pt-0.5 text-right text-[13px]">{c.value}</span>
                    </li>
                  ))}
                </ul>
                {net && (
                  <p className="border-t border-dashed border-line-strong px-2 pb-1 pt-2.5 text-[11px] text-dim">
                    Planner: <span className={net.llm.configured ? "text-blue" : "text-warn"}>{plannerText}</span>. Optional; the rule-based planner works without it.
                  </p>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Crew" icon={<Server aria-hidden />} sub="Two independent worker processes. If one dies, the other takes over." />
              <ul className="divide-y divide-line">
                {workers.map((w) => (
                  <li key={w.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span className="inline-block h-3.5 w-1 rounded-[1px]" style={{ background: w.id === "worker-a" ? "var(--blue)" : "var(--wb)" }} aria-hidden />
                        {w.name}
                      </div>
                      <StatusBadge s={w.status} />
                    </div>
                    <Heartbeat online={w.status === "ONLINE" || w.status === "BUSY"} className="mt-1.5" />
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {w.capabilities.map((c) => (
                        <Badge key={c} t="ink">
                          {c}
                        </Badge>
                      ))}
                      {w.backupCapabilities.map((c) => (
                        <Badge key={c} t="warn">
                          backup · {c}
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

