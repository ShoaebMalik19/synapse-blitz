# Synapse — Demo

Best run: **`wf_a4198e6b7d13412b`** — x402 payment settled, Worker A crashed, Worker B resumed from checkpoint, escrow paid out (planned by the rule-based planner, before Groq was enabled). Groq-generated drafts: `wf_07664bfb445539fd` (tooling gaps), `wf_c85cd9229ef38b20` (ecosystem briefing). Everything below is already on Monad testnet; the demo replays it, no live spending required.

## Setup (once)

```bash
npm run start:all     # web :3000 + x402 data service :4021 + orchestrator + Worker A + Worker B
```

Have the `OPERATOR_ACCESS_TOKEN` from `.env` ready. Optionally keep the terminal visible to show both worker processes.

## Click-by-click walkthrough

1. **Login** — open http://localhost:3000/dashboard → redirected to `/login` → paste the operator token → **Sign in**.
2. **Dashboard** — the primary action is **Generate plan** (planner shown as *Groq · openai/gpt-oss-20b*). On the right, **Replay the proven run** shows the six milestones of `wf_a4198e6b7d13412b`, all DONE, with x402 and escrow-payout explorer links.
3. *(Optional, live LLM call, no spending)* pick **Tooling gaps** and click **Generate plan** → a Groq draft opens under **Review draft and approve**: planner badge *Groq · openai/gpt-oss-20b*, latency/tokens, goal-specific tasks, and "No payment or escrow operations yet — this is a draft." Don't approve it during the demo.
4. **Open run** on the featured card (direct: http://localhost:3000/workflows/wf_a4198e6b7d13412b). The **milestone stepper** at the top tells the story: *Plan created → x402 paid once → Worker A crashed → Worker B resumed → Briefing verified → Escrow settled*.
5. **Recovery handoff** — worker-a attempt #1 **FAILED** (lease expired) → **Checkpoint seq 1** (`✓ purchase_dataset`, state hash verified on load) → worker-b attempt #2 **RECOVERY SUCCEEDED**, "x402 purchase reused — no second charge".
6. **Activity** — key events: `x402 payment settled … (USDC Transfer log matched)` (blue), red **Injected failure: Worker A**, `lease expired`, green **Loaded checkpoint seq 1**, `Policy rejected x402 purchase: amount 250000 exceeds per-call cap`, escrow confirmations. Toggle **all events** for the full log.
7. **Payment & settlement ledger** — `/v1/monad/ecosystem 0.01 USDC` **PAID · VERIFIED ON-CHAIN** (`✓ Transfer log @ block 76881361`); `/v1/monad/deep-dive` struck-through **REJECTED · NOT SIGNED**; escrow `CREATE`, `FUND 0.0100 MON`, `SUBMIT`, `ACCEPT` all **CONFIRMED** with tx links.
8. **View briefing** — milestone strip + three proof cards: *x402 data purchase* (tx), *Escrow payout* (tx), *Report integrity: on-chain result hash = this report*. Below: the cited report, verification checklist, worker history.
9. **Download Markdown** — includes the x402 settlement tx under *Data Provenance*.
10. **Explorer proof** — open the two links (the explorer may show a short browser check first):
    * x402 payment: https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7
    * escrow payout: https://testnet.monadvision.com/tx/0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2

## 60-second presenter script

* **0–10 s** — "Synapse lets agents plan, pay, recover and get paid — with on-chain proof. One goal, one budget: USDC for data, MON for escrow, kept separate."
* **10–20 s** — *(dashboard → Open run)* "New drafts come from Groq, but deterministic checks decide what can run, and nothing runs until I approve. (This proven run predates the Groq integration, so its badge honestly says rule-based.) On approval, a TaskEscrow commitment was created and funded on Monad."
* **20–30 s** — *(timeline + ledger)* "Worker A hit a paid API, got HTTP 402, our policy guard approved one cent, and the payment settled — we verified the USDC Transfer log on-chain. It also tried a 25-cent purchase; the guard rejected it before signing."
* **30–42 s** — *(Recovery handoff)* "Then we killed Worker A mid-task. Its lease expired, Worker B loaded the saved checkpoint and continued — without buying the data again. One purchase, ever."
* **42–52 s** — *(briefing page)* "Every task passed deterministic checks. Worker B committed the briefing hash on-chain and the requester accepted that exact hash — escrow paid out. The on-chain hash matches this report."
* **52–60 s** — *(explorer)* "Here are both transactions on Monad testnet. Plan, pay, fail, recover, verify, settle."

## Running a fresh workflow (optional, spends testnet funds)

Dashboard → **Generate plan** → keep **Failure drill** checked → **Approve & start**. Takes ~70 s. Spends ≤0.01 USDC (x402) and 0.01 MON escrow + gas from the operator wallet.

If something external is down, the UI never fakes success: the affected operation is shown as **BLOCKED · NOT CHARGED** with the exact reason, and failover, verification and the report still work. Earlier runs `wf_01246f8c91c04819` (escrow settled; x402 not attempted — provider returned HTTP 500 at startup) and `wf_2ac61fd5c046ed65` (escrow settled, x402 blocked — no USDC then) remain in history as examples.
