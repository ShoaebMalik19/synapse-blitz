"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BadgeCheck, CircleDollarSign, Download, Landmark, Library, ShieldCheck, Users } from "lucide-react";
import { Nav } from "@/components/nav";
import { deriveStory, StoryStepper } from "@/components/story";
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
  const paid = r.payments.find((p) => p.status === "CONFIRMED");
  const story = deriveStory(r, r.payments, r.escrow);
  const hashMatch = r.onchainEscrowTask && synth?.resultHash ? r.onchainEscrowTask.resultHash.toLowerCase() === synth.resultHash.toLowerCase() : null;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/workflows/${id}`} className="mb-2 inline-flex items-center gap-1 text-xs text-dim hover:text-fg">
            <ArrowLeft className="size-3" /> Execution view
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Final briefing</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge s={r.workflow.status} />
            <Badge t={allPassed ? "ok" : "bad"}>{allPassed ? "all verification checks passed" : "verification incomplete"}</Badge>
            <Badge t={r.workflow.settlementStatus === "SETTLED" ? "ok" : "warn"}>escrow {r.workflow.settlementStatus}</Badge>
          </div>
        </div>
        {r.report && (
          <a href={`/api/workflows/${id}/result?format=md`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-white/[0.02] px-3 text-sm hover:bg-white/[0.06]">
            <Download className="size-4" /> Download Markdown
          </a>
        )}
      </div>

      <section aria-label="Run milestones">
        <StoryStepper steps={story} compact />
      </section>

      <div className="grid gap-2 sm:grid-cols-3">
        <Proof
          ok={Boolean(paid?.verification?.onchain?.verified)}
          label="x402 data purchase"
          value={paid ? `${fmtUsdc(paid.amount_base)} USDC · Transfer log verified` : "no paid purchase in this run"}
          href={paid?.explorer_url}
          hash={paid?.tx_hash}
        />
        <Proof
          ok={r.workflow.settlementStatus === "SETTLED"}
          label="Escrow payout"
          value={r.workflow.settlementStatus === "SETTLED" ? `${fmtMon(r.escrow.find((e) => e.action === "FUND")?.amount_wei ?? null, 2)} MON → Worker B` : `escrow ${r.workflow.settlementStatus.toLowerCase()}`}
          href={accept?.explorer_url}
          hash={accept?.tx_hash}
        />
        <Proof
          ok={hashMatch === true && allPassed}
          label="Report integrity"
          value={hashMatch === true ? "on-chain result hash = this report" : allPassed ? "verification passed; no on-chain hash" : "verification incomplete"}
          hash={r.report?.sha256}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          {r.report ? (
            <article className="prose-report px-5 py-6 sm:px-8">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}>
                {r.report.markdown}
              </ReactMarkdown>
              <div className="mt-8 border-t border-line pt-3 font-mono text-[11px] text-dim [overflow-wrap:anywhere]">artifact sha256 {r.report.sha256}</div>
            </article>
          ) : (
            <Empty>The report is not ready yet. Workflow status: {r.workflow.status}.</Empty>
          )}
        </Card>

        <div className="space-y-4">
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
                <div className="rounded-md border border-line bg-elev p-2 font-mono text-[10.5px] leading-relaxed text-dim">
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
                  <span className={a.worker_id === "worker-a" ? "text-blue" : "text-[#c4b5fd]"}>{a.worker_id}</span>
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

function Proof({ ok, label, value, href, hash }: { ok: boolean; label: string; value: string; href?: string | null; hash?: string | null }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? "border-ok/30 bg-ok/[0.05]" : "border-warn/30 bg-warn/[0.05]"}`}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <BadgeCheck className={`size-4 ${ok ? "text-ok" : "text-warn"}`} aria-hidden /> {label}
        <span className="sr-only">{ok ? "verified" : "not verified"}</span>
      </div>
      <div className="mt-1 text-[13px] font-medium">{value}</div>
      {hash && (
        <div className="mt-1 font-mono text-[11px]">
          {href ? <Ext href={href}>{shortHash(hash, 6)}</Ext> : <span className="text-dim">{shortHash(hash, 6)}</span>}
        </div>
      )}
    </div>
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
