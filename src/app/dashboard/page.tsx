"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, Check, ChevronRight, CircleDollarSign, ClipboardCheck, History, Landmark, PenLine, Server, TriangleAlert } from "lucide-react";
import { Nav } from "@/components/nav";
import { Badge, Button, Card, CardHeader, Dot, Empty, ErrorNote, Ext, Heartbeat, Meter, Mono, Spinner, StatusBadge, cx } from "@/components/ui";
import { api, ApiError, fmtMon, fmtUsdc, shortHash, timeAgo, type Budget, type NetworkStatus, type WorkerInfo, type WorkflowListItem } from "@/lib/client";

const DEFAULT_GOAL = "Research the Monad ecosystem and generate an actionable technical briefing.";

function useAuthRedirect() {
  const router = useRouter();
  return useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) router.push("/login?next=/dashboard");
    },
    [router],
  );
}

function NumberField({ id, label, unit, value, onChange, step, max, hint }: { id: string; label: string; unit: string; value: number; onChange: (n: number) => void; step: number; max: number; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium text-muted">
          {label}
        </label>
        <span className="font-mono text-[10.5px] text-dim">max {max}</span>
      </div>
      <div className="flex h-10 items-center rounded-[4px] border border-line-strong bg-field focus-within:border-fg">
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
  const onErr = useAuthRedirect();
  const [net, setNet] = useState<NetworkStatus | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [flows, setFlows] = useState<WorkflowListItem[] | null>(null);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  const max = net?.policyDefaults;
  const set = (k: keyof Budget) => (v: number) => setBudget((b) => (b ? { ...b, [k]: v } : b));
  const opMon = net?.operator?.balances?.monWei;
  const opUsdc = net?.operator?.balances?.usdcBase;

  const checks = net
    ? [
        { label: "Chain", ok: net.chain.match, value: <Mono>{`${net.chain.rpcChainId ?? "?"} ${net.chain.match ? "· expected" : `≠ ${net.chain.expectedChainId}`}`}</Mono>, sub: `block ${net.chain.blockNumber ?? "?"}` },
        {
          label: "Operator wallet",
          ok: Boolean(net.operator),
          value: net.operator ? <Ext href={net.operator.explorer}><Mono>{shortHash(net.operator.address, 4)}</Mono></Ext> : "Not configured",
          sub: net.operator ? undefined : "Set OPERATOR_PRIVATE_KEY in .env",
        },
        { label: "MON for escrow + gas", ok: Boolean(opMon && BigInt(opMon) > 0n), value: <Mono>{fmtMon(opMon)} MON</Mono>, sub: opMon === "0" ? "Get MON at faucet.monad.xyz" : undefined },
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
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="placard text-dim">Operator console</p>
            <h1 className="font-display mt-1 text-[clamp(1.9rem,3.2vw,2.6rem)] font-semibold leading-none">File a flight plan</h1>
            <p className="mt-2 max-w-[60ch] text-sm text-muted">Give Synapse a goal and spending limits. It plans, buys data, recovers from crashes and settles on Monad — and records all of it.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cx("placard inline-flex items-center gap-2 rounded-[3px] border-2 px-3 py-1.5", !net ? "border-line-strong text-dim" : go ? "border-ok text-ok" : "border-warn text-warn")}>
              {!net ? <Spinner /> : go ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
              Preflight {!net ? "…" : go ? "GO" : `NO-GO · ${failing}`}
            </span>
            <span className="placard inline-flex items-center gap-2 rounded-[3px] border-2 border-line-strong px-3 py-1.5 text-muted">
              Workers {online}/{workers.length || 2}
            </span>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* Composer */}
          <Card>
            <CardHeader title="New workflow" icon={<PenLine />} sub="The AI proposes a plan; fixed rules decide what it may spend." />
            <form
              className="space-y-6 p-5"
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
                  setErr(e instanceof ApiError ? [e.message, ...(e.issues ?? [])].join(" · ") : "Couldn't create the workflow. Check that the server is running.");
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
                  className="w-full resize-none rounded-[4px] border border-line-strong bg-field px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-fg"
                />
                <div className="mt-1 text-right font-mono text-[10.5px] text-dim">{goal.length}/500</div>
              </div>

              {budget && max ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <fieldset className="space-y-3 rounded-[4px] border border-line p-4">
                      <legend className="placard flex items-center gap-2 px-1 text-fg">
                        <CircleDollarSign className="size-3.5 text-blue" /> Data purchases · USDC
                      </legend>
                      <NumberField id="x402" label="Total x402 budget" unit="USDC" value={budget.x402Usdc} onChange={set("x402Usdc")} step={0.01} max={max.x402Usdc} />
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField id="percall" label="Per-call cap" unit="USDC" value={budget.perCallUsdc} onChange={set("perCallUsdc")} step={0.005} max={max.perCallUsdc} />
                        <NumberField id="approve" label="Ask me above" unit="USDC" value={budget.approvalThresholdUsdc} onChange={set("approvalThresholdUsdc")} step={0.005} max={max.approvalThresholdUsdc} />
                      </div>
                    </fieldset>
                    <fieldset className="space-y-3 rounded-[4px] border border-line p-4">
                      <legend className="placard flex items-center gap-2 px-1 text-fg">
                        <Landmark className="size-3.5 text-accent-ink" /> Escrow & gas · MON
                      </legend>
                      <NumberField id="escrow" label="Escrow payout" unit="MON" value={budget.escrowMon} onChange={set("escrowMon")} step={0.001} max={max.escrowMon} hint="Locked on Monad; paid only for the accepted result" />
                      <NumberField id="gas" label="Gas allowance" unit="MON" value={budget.gasMon} onChange={set("gasMon")} step={0.01} max={max.gasMon} />
                    </fieldset>
                  </div>

                  {/* Budget envelope: shows how the caps nest inside the total */}
                  <div className="rounded-[4px] border border-dashed border-line-strong p-4">
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
                      Marks show when you are asked to approve (ask) and the per-call cap (cap). Any single purchase above the cap is refused before signing. USDC and MON are separate budgets and are never converted. Server limits cap every field, so you can only lower them.
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-dim">
                  <Spinner /> Loading policy limits…
                </div>
              )}

              {err && <ErrorNote>{err}</ErrorNote>}
              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
                <Button type="submit" className="h-11 px-5" disabled={busy || !budget || goal.trim().length < 10}>
                  {busy ? <Spinner /> : <Brain className="size-4" />} {busy ? `Planning${net?.llm.provider ? ` with ${net.llm.provider}` : ""}…` : "Generate plan"}
                </Button>
                <span className="text-xs text-dim">
                  {net ? (
                    net.llm.configured ? (
                      <>
                        Planner <Mono className="text-muted">{net.llm.provider} · {net.llm.model}</Mono>, checked by fixed rules. Falls back to rule-based if the AI fails.
                      </>
                    ) : (
                      "Rule-based planner (no AI key configured)."
                    )
                  ) : (
                    "…"
                  )}
                </span>
              </div>
            </form>
          </Card>

          {/* Preflight */}
          <Card>
            <CardHeader title="Preflight checklist" icon={<ClipboardCheck />} sub="Signing keys stay on the server and never reach the browser." />
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
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader title="Flight log" icon={<History />} sub="Every workflow, newest first." right={flows?.length ? <span className="font-mono text-[11px] text-dim">{flows.length} runs</span> : undefined} />
            {flows === null ? (
              <Empty>
                <Spinner />
              </Empty>
            ) : flows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="font-display text-xl font-semibold">No flights recorded yet</p>
                <p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted">Generate your first plan above. Keep the failure drill on to record a crash and a recovery for your demo.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {flows.map((f) => (
                  <li key={f.id}>
                    <Link href={`/workflows/${f.id}`} className="group flex items-center gap-3 px-4 py-3 hover:bg-fg/[0.03]">
                      <Dot s={f.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{f.goal}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-dim">
                          <span>{f.id}</span>
                          <span>
                            {f.completed_count}/{f.task_count} tasks
                          </span>
                          <span>{f.planner}</span>
                          <span>{timeAgo(f.created_at)}</span>
                        </div>
                      </div>
                      <div className="hidden flex-col items-end gap-1 sm:flex">
                        <StatusBadge s={f.status} />
                        <span className="font-mono text-[10px] text-dim">escrow {f.settlement_status.toLowerCase().replace(/_/g, " ")}</span>
                      </div>
                      <ChevronRight className="size-4 text-dim transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Crew" icon={<Server />} sub="Two independent worker processes. If one dies, the other takes over." />
            <div className="space-y-3 p-4">
              {workers.map((w) => {
                const alive = w.status === "ONLINE" || w.status === "BUSY";
                return (
                  <div key={w.id} className="rounded-[4px] border border-line-strong bg-bg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span className="inline-block h-3.5 w-1 rounded-[1px]" style={{ background: w.id === "worker-a" ? "var(--blue)" : "var(--wb)" }} aria-hidden />
                        {w.name}
                      </div>
                      <StatusBadge s={w.status} />
                    </div>
                    <Heartbeat online={alive} className="mt-2" />
                    <p className="mt-1 text-xs leading-relaxed text-muted">{w.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
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
                    <div className="mt-2 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                      <span>pid {w.pid ?? "—"}</span>
                      <span>heartbeat {timeAgo(w.lastHeartbeat)}</span>
                      <span>payee {shortHash(w.payee, 4)}</span>
                    </div>
                  </div>
                );
              })}
              {!workers.length && <Empty>Loading workers…</Empty>}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
