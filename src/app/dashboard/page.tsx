"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Bot, Brain, ChevronRight, CircleDollarSign, Cpu, Link2, Server, Sparkles, Wallet } from "lucide-react";
import { Nav } from "@/components/nav";
import { Badge, Button, Card, CardHeader, Dot, Empty, ErrorNote, Ext, Mono, Spinner, StatusBadge, cx } from "@/components/ui";
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

function NumberField({ label, unit, value, onChange, step, max, hint }: { label: string; unit: string; value: number; onChange: (n: number) => void; step: number; max: number; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono text-[10.5px] text-dim">max {max}</span>
      </div>
      <div className="flex h-10 items-center rounded-lg border border-line-strong bg-elev focus-within:border-violet/60">
        <input
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
    </label>
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

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Workflow Studio</h1>
            <p className="mt-1 text-sm text-muted">Define a goal and spending limits. Synapse plans, executes, pays and settles — with evidence.</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* Composer */}
          <Card>
            <CardHeader title="New workflow" icon={<Sparkles className="size-4" />} sub="The planner proposes; deterministic code authorizes." />
            <form
              className="space-y-5 p-4"
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
                  setErr(e instanceof ApiError ? [e.message, ...(e.issues ?? [])].join(" · ") : "Failed to create workflow");
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
                  className="w-full resize-none rounded-lg border border-line-strong bg-elev px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-violet/60"
                />
              </div>

              {budget && max ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-lg border border-line bg-white/[0.015] p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <CircleDollarSign className="size-3.5 text-blue" /> x402 data purchases
                      <Badge t="blue">USDC</Badge>
                    </div>
                    <NumberField label="Total x402 budget" unit="USDC" value={budget.x402Usdc} onChange={set("x402Usdc")} step={0.01} max={max.x402Usdc} />
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField label="Per-call cap" unit="USDC" value={budget.perCallUsdc} onChange={set("perCallUsdc")} step={0.005} max={max.perCallUsdc} />
                      <NumberField label="Approval above" unit="USDC" value={budget.approvalThresholdUsdc} onChange={set("approvalThresholdUsdc")} step={0.005} max={max.approvalThresholdUsdc} />
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-line bg-white/[0.015] p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Link2 className="size-3.5 text-violet" /> Monad escrow & gas
                      <Badge t="violet">MON</Badge>
                    </div>
                    <NumberField label="Escrow payout (deliverable)" unit="MON" value={budget.escrowMon} onChange={set("escrowMon")} step={0.001} max={max.escrowMon} hint="Locked in TaskEscrow; paid on accepted result" />
                    <NumberField label="Gas allowance" unit="MON" value={budget.gasMon} onChange={set("gasMon")} step={0.01} max={max.gasMon} />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-dim">
                  <Spinner /> Loading policy limits…
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-dim">
                USDC and MON are separate budgets — never converted. Server-side ceilings cap every field; you can only lower them.
              </p>
              {err && <ErrorNote>{err}</ErrorNote>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || !budget || goal.trim().length < 10}>
                  {busy ? <Spinner /> : <Brain className="size-4" />} {busy ? "Planning…" : "Generate plan"}
                </Button>
                <span className="text-xs text-dim">
                  Planner: {net ? (net.llm.configured ? `LLM (${net.llm.model})` : "rule-based (no LLM key configured)") : "…"}
                </span>
              </div>
            </form>
          </Card>

          {/* Network / wallet */}
          <Card>
            <CardHeader title="Network & wallet" icon={<Wallet className="size-4" />} sub="Server-side testnet operator wallet (keys never leave the server)" />
            <div className="space-y-3 p-4 text-sm">
              {netErr && <ErrorNote>{netErr}</ErrorNote>}
              {!net && !netErr && (
                <div className="flex items-center gap-2 text-dim">
                  <Spinner /> Probing Monad RPC, facilitator and services…
                </div>
              )}
              {net && (
                <>
                  <Row label="Chain" ok={net.chain.match}>
                    <Mono>
                      {net.chain.rpcChainId ?? "?"} {net.chain.match ? "= expected" : `≠ ${net.chain.expectedChainId}`}
                    </Mono>
                    <span className="text-dim"> · block {net.chain.blockNumber ?? "?"}</span>
                  </Row>
                  <Row label="Operator" ok={Boolean(net.operator)}>
                    {net.operator ? <Ext href={net.operator.explorer}><Mono>{shortHash(net.operator.address, 4)}</Mono></Ext> : "not configured"}
                  </Row>
                  <Row label="MON balance" ok={Boolean(opMon && BigInt(opMon) > 0n)}>
                    <Mono>{fmtMon(opMon)} MON</Mono>
                    {opMon === "0" && <span className="ml-2 text-xs text-warn">fund at faucet.monad.xyz</span>}
                  </Row>
                  <Row label="USDC balance" ok={Boolean(opUsdc && BigInt(opUsdc) > 0n)}>
                    <Mono>{fmtUsdc(opUsdc)} USDC</Mono>
                    {opUsdc === "0" && <span className="ml-2 text-xs text-warn">fund at faucet.circle.com</span>}
                  </Row>
                  <Row label="TaskEscrow" ok={net.escrow.deployed}>
                    {net.escrow.address ? <Ext href={net.escrow.explorer}><Mono>{shortHash(net.escrow.address, 4)}</Mono></Ext> : <span className="text-warn">not deployed</span>}
                  </Row>
                  <Row label="x402 facilitator" ok={net.x402.exactSupported}>
                    <span className="text-xs">{net.x402.exactSupported ? `exact @ ${net.x402.network}` : net.x402.facilitatorError ?? "unsupported"}</span>
                  </Row>
                  <Row label="Paid data service" ok={net.x402.service.online}>
                    <Mono>{net.x402.service.url.replace(/^https?:\/\//, "")}</Mono>
                  </Row>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader title="Recent workflows" icon={<Activity className="size-4" />} />
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
                    <Link href={`/workflows/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
                      <Dot s={f.status} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{f.goal}</div>
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
                      <ChevronRight className="size-4 text-dim" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Worker registry" icon={<Server className="size-4" />} sub="Prototype allowlist — not a permissionless marketplace" />
            <div className="space-y-3 p-4">
              {workers.map((w) => (
                <div key={w.id} className="rounded-lg border border-line bg-elev p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {w.id === "worker-a" ? <Bot className="size-4 text-blue" /> : <Cpu className="size-4 text-violet" />}
                      {w.name}
                    </div>
                    <StatusBadge s={w.status} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{w.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
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
                  <div className="mt-2 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-dim">
                    <span>pid {w.pid ?? "—"}</span>
                    <span>heartbeat {timeAgo(w.lastHeartbeat)}</span>
                    <span>payee {shortHash(w.payee, 4)}</span>
                  </div>
                </div>
              ))}
              {!workers.length && <Empty>Loading workers…</Empty>}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-xs text-muted">
        <span className={cx("size-1.5 rounded-full", ok ? "bg-ok" : "bg-warn")} />
        {label}
      </span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}
