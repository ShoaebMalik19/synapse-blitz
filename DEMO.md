# Synapse — 3-minute demo

## Before you present (5 min)

```bash
npm run status            # chain 10143, operator MON + USDC > 0, facilitator exact@eip155:10143 SUPPORTED
npm run deploy:escrow     # once; writes MONAD_ESCROW_ADDRESS
npm run build && npm run start:all
```

Open http://localhost:3000/dashboard and sign in with `OPERATOR_ACCESS_TOKEN`. Check that the **Network & wallet** card is all green and that both workers show **ONLINE**. Keep a terminal with `npm run start:all` logs visible next to the browser so the audience can see Worker A's process exit.

## Script

**0:00 — The problem (20 s)**
"Agents can plan and call tools, but when work crosses operators there's no enforceable budget, no portable checkpoint, and no outcome-based payment. Synapse adds all three — using x402 for metered purchases and Monad for settlement."

**0:20 — Goal + budget (25 s)** · Dashboard
* Objective: *Research the Monad ecosystem and generate an actionable technical briefing.*
* Point at the two budget panels: "USDC for x402 data, MON for escrow and gas — separate, never converted. The server caps every field; I can only lower them."
* Click **Generate plan**.

**0:45 — Validated DAG (20 s)** · Workflow page
* "The planner proposed research → analysis → briefing. Zod and graph checks rejected anything cyclic, unknown or over budget. Workers are assigned by code, not the LLM."
* Leave **Failure drill** checked → **Approve & start**.

**1:05 — On-chain commitment (15 s)**
* Ledger shows `escrow CREATE` and `FUND` with explorer links: "the deliverable's spec hash and 0.01 MON are now locked on Monad."

**1:20 — x402 purchase + policy (25 s)**
* Timeline: `HTTP 402 from Synapse Monad Data Service` → `Policy approved and reserved 0.01 USDC` → `settled on Monad testnet and verified (USDC Transfer log matched)`. Open the tx link.
* Next line: `Policy rejected x402 purchase: amount 250000 exceeds per-call cap` — "the agent asked for a $0.25 deep-dive; the guard refused before any signature."

**1:45 — Crash and recovery (35 s)**
* Timeline turns red: `Injected failure: Worker A … terminating` (terminal shows `exited code=137`).
* `lease expired` → `Worker B claimed recovery attempt #2 from checkpoint seq N` → `Loaded checkpoint` → `skipping completed steps: purchase_dataset, …`.
* Recovery timeline card: attempt #1 FAILED (worker-a), #2 RECOVERY SUCCEEDED (worker-b). Ledger still shows **one** x402 payment.

**2:20 — Verification + settlement (25 s)**
* `Verification passed: 9/9 checks` → `TaskEscrow.submitResult (Worker B)` → `TaskEscrow.acceptResult (settlement) confirmed` → `Escrow settled on Monad and verified (event + state)`.
* Click **View briefing**.

**2:45 — Result (15 s)**
* Cited briefing, verification checklist, worker history with the RECOVERY attempt, cost breakdown in USDC and MON, on-chain state `Settled` with "result hash on-chain = report artifact". **Download Markdown**.
* Close: "Plan, pay, fail, recover, verify, settle — with every claim backed by a transaction hash."

## If something external is down

The UI never fakes success. If the wallet is unfunded or the facilitator is unavailable, the exact operation is shown as **BLOCKED** with its reason, and the rest of the workflow (planning, failover, verification, report) still runs. Say so explicitly and show the policy rejection + failover, which are fully local.

## Manual failure injection (alternative to the drill)

Approve without the drill, then press **Inject Worker Failure** while the research node is running. It arms a real crash that fires right after Worker A's next durable checkpoint.
