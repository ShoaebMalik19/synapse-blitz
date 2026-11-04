import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/nav";
import { Glyph, TapeLegend, TapeReplay, type MarkKind } from "@/components/tape";
import { ButtonLink, Card, Ext, Rec } from "@/components/ui";

const EXPLORER = "https://testnet.monadvision.com/tx/";
const X402_TX = "0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7";
const PAYOUT_TX = "0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2";
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const findings: { glyph: MarkKind; title: string; body: string; evidence: React.ReactNode }[] = [
  {
    glyph: "resume",
    title: "Paid once, even after a crash.",
    body: "Worker A bought the data, saved a checkpoint, then was killed. Worker B loaded that checkpoint and carried on. The purchase was never repeated.",
    evidence: (
      <>
        x402 payment <Ext href={EXPLORER + X402_TX}>{short(X402_TX)}</Ext>
      </>
    ),
  },
  {
    glyph: "reject",
    title: "Overspending is stopped before signing.",
    body: "A 0.25 USDC request hit the 0.02 per-call cap. The policy guard refused it before any signature existed, so nothing could be charged.",
    evidence: <>Policy guard · 0 USDC charged</>,
  },
  {
    glyph: "settle",
    title: "Escrow pays only for the verified result.",
    body: "Worker B committed the briefing's hash on Monad. The requester accepted that exact hash, and only then did escrow release the MON.",
    evidence: (
      <>
        Escrow payout <Ext href={EXPLORER + PAYOUT_TX}>{short(PAYOUT_TX)}</Ext>
      </>
    ),
  },
];

const route = [
  ["Goal + budget", "USDC for data and MON for work, capped separately"],
  ["Plan", "AI proposes tasks; code validates the graph"],
  ["Commit", "Escrow created and funded on Monad"],
  ["Buy data", "x402 payment, checked by the policy guard"],
  ["Checkpoint", "Progress and payments hashed and saved"],
  ["Recover", "If a worker dies, another resumes"],
  ["Verify & settle", "Result hash accepted, escrow pays out"],
];

const plate: [string, string][] = [
  ["Run", "wf_a4198e6b"],
  ["Network", "Monad testnet · 10143"],
  ["Data bought", "0.01 USDC · once"],
  ["Blocked", "0.25 USDC"],
  ["Crashes survived", "1"],
  ["Escrow", "0.01 MON · settled"],
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line-strong">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="#tape" className="hidden px-2 py-2 text-[13px] font-medium text-muted hover:text-fg sm:inline">
              The recording
            </Link>
            <Link href="https://github.com/ShoaebMalik19/synapse" className="hidden px-2 py-2 text-[13px] font-medium text-muted hover:text-fg sm:inline">
              GitHub
            </Link>
            <ThemeToggle />
            <ButtonLink href="/dashboard" className="h-9 px-3.5">
              Open console
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* Hero: the question is the thesis */}
        <section className="grid gap-10 pb-14 pt-14 sm:pt-20 lg:grid-cols-[1fr_280px] lg:items-end">
          <div>
            <p className="placard text-accent-ink">Incident report · Monad testnet</p>
            <h1 className="font-display mt-5 max-w-[15ch] text-[clamp(2.6rem,6.4vw,5.2rem)] font-semibold leading-[0.95]">
              What happens when an AI agent crashes after it already paid?
            </h1>
            <p className="mt-7 max-w-[58ch] text-pretty text-[17px] leading-relaxed text-muted">
              Synapse records every payment, checkpoint and payout like a flight recorder. When a worker dies mid-task, a backup picks up from the
              last checkpoint without paying twice, and escrow on Monad only pays for work that passes verification.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href="/dashboard" className="h-11 px-5">
                Open the console <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="#tape" variant="outline" className="h-11 px-5">
                Watch the recording <ArrowDown className="size-4" />
              </ButtonLink>
            </div>
          </div>

          {/* Data plate — like the label riveted to a recorder */}
          <dl className="rounded-md border-2 border-fg bg-surface p-4 font-mono text-[12px]">
            <div className="placard -mx-4 -mt-4 mb-3 flex items-center justify-between border-b-2 border-fg bg-accent px-4 py-1.5 text-on-accent">
              <span>Flight data</span>
              <span>Do not open</span>
            </div>
            {plate.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed border-line-strong py-1.5 last:border-b-0">
                <dt className="text-dim">{k}</dt>
                <dd className="text-right text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Signature: the recorder tape */}
        <section id="tape" className="scroll-mt-6 pb-16">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <div className="placard text-fg">Recorder tape · run wf_a4198e6b7d13412b</div>
                <div className="mt-1 text-xs text-dim">Replay of a recorded run on Monad testnet. Event order is exact; timing is approximate.</div>
              </div>
              <Rec label="Replay" />
            </div>
            <TapeReplay />
          </Card>
          <TapeLegend className="mt-3 px-1" />
        </section>

        {/* Findings */}
        <section className="pb-20">
          <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">What the recording proves</h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong md:grid-cols-3">
            {findings.map((f) => (
              <article key={f.title} className="flex flex-col bg-surface p-6">
                <span className="grid size-8 place-items-center rounded-[4px] border border-line-strong bg-bg">
                  <Glyph kind={f.glyph} color="var(--fg)" />
                </span>
                <h3 className="mt-5 text-[19px] font-semibold leading-snug tracking-tight">{f.title}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{f.body}</p>
                <p className="mt-5 border-t border-dashed border-line-strong pt-3 font-mono text-[11.5px] text-dim">{f.evidence}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Route: this one is a true sequence, so it's numbered */}
        <section className="pb-20">
          <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">The route every workflow flies</h2>
          <ol className="relative mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-7 lg:gap-3 lg:before:absolute lg:before:inset-x-0 lg:before:top-[11px] lg:before:border-t-2 lg:before:border-dashed lg:before:border-line-strong lg:before:content-['']">
            {route.map(([t, d], i) => (
              <li key={t} className="relative flex gap-3 lg:block">
                <span
                  className={`relative grid size-6 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-semibold ${
                    i === 5 ? "border-accent bg-accent text-on-accent" : "border-fg bg-bg text-fg"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="lg:mt-3">
                  <div className="text-[14px] font-semibold">{t}</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-muted">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* What goes where */}
        <section className="grid gap-4 pb-24 lg:grid-cols-2">
          {[
            {
              title: "Written to Monad",
              rows: [
                ["Task commitment", "requester, payee, verifier, deadline, spec hash"],
                ["Escrow", "native MON, released only on the accepted result hash"],
                ["x402 settlement", "USDC transferWithAuthorization via the facilitator"],
                ["Admin keys", "none — no withdrawal path except payee or refund"],
              ],
            },
            {
              title: "Kept by Synapse",
              rows: [
                ["Planning", "prompts, task graph, raw worker outputs"],
                ["Reliability", "leases, heartbeats, checkpoints, retries, event log"],
                ["Safety", "policy guard and deterministic output checks"],
                ["Workers", "allowlisted prototype registry, not an open market"],
              ],
            },
          ].map((col) => (
            <Card key={col.title}>
              <div className="placard border-b border-line px-5 py-3 text-fg">{col.title}</div>
              <dl className="divide-y divide-line">
                {col.rows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[130px_1fr] gap-4 px-5 py-3 text-sm">
                    <dt className="font-medium">{k}</dt>
                    <dd className="text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t border-line-strong">
        <div className="recorder-stripe h-1.5" aria-hidden />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <span className="placard text-dim">Synapse · testnet prototype</span>
          <span className="text-xs text-dim">On-chain receipts prove payment and settlement, not the quality of AI output.</span>
        </div>
      </footer>
    </div>
  );
}
