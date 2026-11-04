"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BadgeCheck, CircleDollarSign, Download, Landmark, Library, Link2, ShieldCheck, Users } from "lucide-react";
import { EvidenceChain } from "@/components/evidence";
import { Nav } from "@/components/nav";
import { Badge, Card, CardHeader, Empty, ErrorNote, Ext, Mono, Spinner, Stat, StatusBadge } from "@/components/ui";
import { api, ApiError, clock, fmtMon, fmtUsdc, paymentLabel, shortHash, type PaymentsResponse, type WorkflowDetail } from "@/lib/client";

type ResultResponse = WorkflowDetail &
  PaymentsResponse & {
    report: { markdown: string; sources: { id: string; title: string; url: string; kind: string }[]; sha256: string; createdAt: number } | null;
    verifications: { taskId: string; passed: boolean; checks: { id: string; label: string; passed: boolean; detail?: string }[] }[];
    onchainEscrowTask: { stateName: string; amount: string; payee: string; resultHash: string; specHash: string } | null;
  };

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [r, setR] = useState<ResultResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api<ResultResponse>(`/api/workflows/${id}/result`)
        .then((x) => !stop && setR(x))
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) router.push(`/login?next=/workflows/${id}/result`);
          else setErr((e as Error).message);
        });
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, router]);

  if (err && !r) return <Shell><ErrorNote>{err}</ErrorNote></Shell>;
  if (!r) return <Shell><div className="flex items-center gap-2 text-dim"><Spinner /> Loading result…</div></Shell>;

  const synth = r.tasks.find((t) => t.capability === "synthesis");
  const accept = r.escrow.find((e) => e.action === "ACCEPT");
  const allPassed = r.verifications.length > 0 && r.verifications.every((v) => v.passed);
  const hashMatch = r.onchainEscrowTask && synth?.resultHash ? r.onchainEscrowTask.resultHash.toLowerCase() === synth.resultHash.toLowerCase() : null;
  const av = accept?.verification as { eventFound?: boolean; resultHashMatches?: boolean; eventResultHash?: string; onchainState?: string } | null | undefined;
  const synthVerified = r.verifications.find((v) => v.taskId === synth?.taskId)?.passed;
  const settled = r.onchainEscrowTask?.stateName === "Settled";

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/workflows/${id}`} className="mb-2 inline-flex items-center gap-1 text-xs text-dim hover:text-fg">
            <ArrowLeft className="size-3" /> Execution view
          </Link>
          <p className="placard text-dim">Deliverable · {id}</p>
          <h1 className="font-display mt-1 text-[clamp(1.9rem,3.2vw,2.6rem)] font-semibold leading-none">Final briefing</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge s={r.workflow.status} />
            <Badge t={allPassed ? "ok" : "bad"}>{allPassed ? "all verification checks passed" : "verification incomplete"}</Badge>
            <Badge t={r.workflow.settlementStatus === "SETTLED" ? "ok" : "warn"}>escrow {r.workflow.settlementStatus}</Badge>
          </div>
        </div>
        {r.report && (
          <a href={`/api/workflows/${id}/result?format=md`} className="inline-flex h-10 items-center gap-2 rounded-[4px] border border-line-strong bg-surface px-4 text-sm font-medium hover:border-fg/40">
            <Download className="size-4" /> Download Markdown
          </a>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="min-w-0">
          {r.report ? (
            <article className="prose-report px-5 py-8 sm:px-10">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}>
                {r.report.markdown}
              </ReactMarkdown>
              <div className="mt-10 border-t-2 border-fg pt-3 font-mono text-[11px] break-all text-dim">report sha256 {r.report.sha256}</div>
            </article>
          ) : (
            <Empty>The report is not ready yet. Workflow status: {r.workflow.status}.</Empty>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="border-2 border-fg">
            <CardHeader title="Proof chain" icon={<Link2 />} sub="From the worker's output to the payout on Monad. Each link is checked." />
            <div className="p-4">
              <EvidenceChain
                steps={[
                  { label: "Briefing artifact", value: synth?.resultHash, state: synth?.resultHash ? (synthVerified === false ? "bad" : "ok") : "pending", detail: synthVerified ? "Passed every verification check" : undefined },
                  { label: "Committed on Monad", value: r.onchainEscrowTask?.resultHash, matchesPrev: hashMatch, state: hashMatch === true ? "ok" : hashMatch === false ? "bad" : "pending", detail: "submitResult by Worker B" },
                  {
                    label: "Accepted by requester",
                    value: av?.eventResultHash ?? accept?.tx_hash,
                    href: accept?.explorer_url,
                    matchesPrev: av?.resultHashMatches ?? null,
                    state: av?.eventFound && av.resultHashMatches ? "ok" : av ? "bad" : "pending",
                    detail: "TaskSettled event read back from the chain",
                  },
                  { label: "Escrow state", value: r.onchainEscrowTask?.stateName ?? null, state: settled ? "ok" : "pending", detail: settled ? "MON released to the payee" : "Waiting for settlement" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Settlement evidence" icon={<Landmark className="size-4" />} sub="Read back from Monad testnet" />
            <div className="space-y-3 p-4 text-sm">
              {r.onchainEscrowTask ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="On-chain state" value={r.onchainEscrowTask.stateName} />
                    <Stat label="Escrow amount" value={`${fmtMon(r.onchainEscrowTask.amount)} MON`} sub="0 after settlement" />
                  </div>
                  <div className="font-mono text-[11px] text-dim">payee {shortHash(r.onchainEscrowTask.payee, 6)}</div>
                  <div className="font-mono text-[11px] text-dim">
                    result hash on-chain {shortHash(r.onchainEscrowTask.resultHash, 8)}{" "}
                    {hashMatch === true ? <span className="text-ok">= report artifact</span> : hashMatch === false ? <span className="text-bad">≠ report</span> : null}
                  </div>
                </>
              ) : (
                <div className="text-xs text-warn">No on-chain escrow task readable ({r.workflow.settlementNote ?? r.workflow.settlementStatus}).</div>
              )}
              <ul className="space-y-1.5">
                {r.escrow.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono">{e.action}</span>
                    <span className="flex items-center gap-2">
                      {e.tx_hash ? <Ext href={e.explorer_url}>{shortHash(e.tx_hash, 4)}</Ext> : <span className="text-dim">{e.status_reason?.slice(0, 40)}</span>}
                      <StatusBadge s={e.status} />
                    </span>
                  </li>
                ))}
              </ul>
              {accept?.verification && (
                <div className="rounded-[3px] border border-line bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-dim">
                  event TaskSettled: {String(accept.verification.eventFound)} · hash match: {String(accept.verification.resultHashMatches)} · state: {String(accept.verification.onchainState)}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Cost breakdown" icon={<CircleDollarSign className="size-4" />} sub="USDC and MON tracked separately" />
            <div className="space-y-2 p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="x402 confirmed" value={`${fmtUsdc(r.budget.x402.confirmedBase)} USDC`} sub={`cap ${fmtUsdc(r.budget.x402.capBase)}`} />
                <Stat label="Rejected by policy" value={`${fmtUsdc(r.budget.x402.rejectedBase)} USDC`} sub="never signed" />
              </div>
              <ul className="space-y-1.5 pt-1">
                {r.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono">{new URL(p.resource_url).pathname}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Mono className={paymentLabel(p).charged ? "" : "text-dim line-through"}>{fmtUsdc(p.amount_base)}</Mono>
                      {p.tx_hash && <Ext href={p.explorer_url}>tx</Ext>}
                      <Badge t={paymentLabel(p).tone}>{paymentLabel(p).label}</Badge>
                    </span>
                  </li>
                ))}
                {r.escrow
                  .filter((e) => e.amount_wei)
                  .map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono">{e.action === "FUND" ? "escrow (payout)" : "gas top-up"}</span>
                      <span className="flex items-center gap-2">
                        <Mono>{fmtMon(e.amount_wei)} MON</Mono>
                        <StatusBadge s={e.status} />
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader title="Verification" icon={<ShieldCheck className="size-4" />} sub="Deterministic checks per task" />
            <div className="space-y-3 p-4">
              {r.verifications.map((v) => (
                <div key={v.taskId}>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                    <BadgeCheck className={v.passed ? "size-3.5 text-ok" : "size-3.5 text-bad"} /> {v.taskId}
                  </div>
                  <ul className="space-y-0.5 pl-5 text-[11.5px]">
                    {v.checks.map((c) => (
                      <li key={c.id} className={c.passed ? "text-muted" : "text-bad"}>
                        {c.passed ? "✓" : "✗"} {c.label}
                        {c.detail ? <span className="text-dim"> ({c.detail})</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Worker history" icon={<Users className="size-4" />} />
            <ul className="space-y-1.5 p-4 text-xs">
              {r.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-dim">{clock(a.started_at)}</span>
                  <span className="font-mono">{a.task_id}</span>
                  <span className={a.worker_id === "worker-a" ? "text-blue" : "text-wb"}>{a.worker_id}</span>
                  <Badge t={a.kind === "RECOVERY" ? "warn" : "muted"}>{a.kind}</Badge>
                  <StatusBadge s={a.status} />
                </li>
              ))}
            </ul>
          </Card>

          {r.report && (
            <Card>
              <CardHeader title="Sources" icon={<Library className="size-4" />} />
              <ul className="space-y-1.5 p-4 text-xs">
                {r.report.sources.map((s) => (
                  <li key={s.id}>
                    <Ext href={s.url}>{s.title}</Ext> <span className="text-dim">· {s.kind}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
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
