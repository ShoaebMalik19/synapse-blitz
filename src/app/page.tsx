import Link from "next/link";
import { ArrowRight, Boxes, CircleDollarSign, GitBranch, LifeBuoy, ShieldCheck, Workflow } from "lucide-react";
import { Logo } from "@/components/nav";
import { Badge, ButtonLink } from "@/components/ui";

const pillars = [
  {
    icon: Workflow,
    title: "Plan → validated DAG",
    body: "An LLM (or deterministic fallback) proposes tasks. Zod + graph checks reject cycles, unknown capabilities and over-budget plans before anything runs.",
  },
  {
    icon: CircleDollarSign,
    title: "x402 metered purchases",
    body: "Agents hit a paid API, receive HTTP 402, and a deterministic policy guard checks payee, asset, network and caps before signing an EIP-3009 authorization.",
  },
  {
    icon: ShieldCheck,
    title: "Monad TaskEscrow",
    body: "The deliverable is committed on-chain, escrow is funded in MON, and payout happens only when the requester accepts the exact verified result hash.",
  },
  {
    icon: LifeBuoy,
    title: "Checkpointed failover",
    body: "Workers lease tasks and persist hashed checkpoints. Kill one mid-task and another resumes from stored progress — without re-buying data.",
  },
];

const flow = [
  ["Goal + budget", "Operator sets USDC and MON limits separately"],
  ["Planner", "Typed DAG, validated deterministically"],
  ["Escrow commit", "createTask + fundTask on Monad"],
  ["Worker A", "x402 data purchase, sources, checkpoints"],
  ["Failover", "Worker B resumes from checkpoint"],
  ["Verify", "Schema, citations, hashes"],
  ["Settle", "submitResult → acceptResult on Monad"],
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="glow pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[700px]" />
      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="https://github.com/ShoaebMalik19/synapse-blitz" className="hidden rounded-md px-3 py-1.5 text-sm text-muted hover:text-fg sm:inline">
            GitHub
          </Link>
          <ButtonLink href="/dashboard" variant="outline" className="h-9">
            Dashboard
          </ButtonLink>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6">
        <section className="pb-20 pt-16 text-center sm:pt-24">
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            <Badge t="violet">Monad testnet</Badge>
            <Badge t="blue">x402 v2</Badge>
            <Badge>Hackathon prototype</Badge>
          </div>
          <h1 className="mx-auto max-w-4xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-6xl">
            Agent workflows that <span className="text-gradient">pay, recover and settle</span> on their own.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Synapse turns a goal and a budget into a verified multi-agent workflow. Independent workers buy data with x402,
            checkpoint their progress, fail over to each other, and get paid through outcome-based escrow on Monad.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/dashboard" className="h-11 px-5">
              Launch Synapse <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="#architecture" variant="outline" className="h-11 px-5">
              How it works
            </ButtonLink>
          </div>
        </section>

        <section className="grid gap-3 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-xl border border-line bg-surface/70 p-5">
              <p.icon className="size-5 text-violet" />
              <h3 className="mt-4 text-[15px] font-medium">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </section>

        <section id="architecture" className="pb-20">
          <div className="mb-6 flex items-center gap-2 text-sm text-muted">
            <GitBranch className="size-4 text-violet" /> Execution path of one workflow
          </div>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {flow.map(([t, d], i) => (
              <li key={t} className="relative rounded-xl border border-line bg-elev p-4">
                <div className="font-mono text-[11px] text-dim">{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-2 text-sm font-medium">{t}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{d}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 pb-24 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface/70 p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Boxes className="size-4 text-violet" /> On-chain (Monad)
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>• Task commitment: id, requester, payee, verifier, deadline, spec hash</li>
              <li>• Native-MON escrow, result hash, settlement / refund events</li>
              <li>• x402 USDC settlement (EIP-3009 transferWithAuthorization via facilitator)</li>
              <li>• No admin withdrawal path; payout bound to the accepted result hash</li>
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface/70 p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Workflow className="size-4 text-blue" /> Off-chain (Synapse orchestrator)
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>• Planning, prompts, worker execution and raw outputs</li>
              <li>• Leases, heartbeats, checkpoints, retries and the event log (SQLite)</li>
              <li>• Deterministic policy guard and output verification</li>
              <li>• Prototype worker registry — allowlisted, not a permissionless market</li>
            </ul>
          </div>
        </section>
      </main>
      <footer className="relative z-10 border-t border-line py-8 text-center text-xs text-dim">
        Synapse prototype · testnet only · on-chain receipts prove payment and settlement, not the quality of AI output.
      </footer>
    </div>
  );
}
