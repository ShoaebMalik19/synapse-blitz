# Synapse

**Agents that plan, pay, crash, recover and get paid, with every payment and payout settled on Monad.**

> Monad Blitz Mumbai [Devcon Edition] submission · hackathon prototype · **Monad testnet only**

| | |
|---|---|
| **Project** | Synapse: decentralized agent workflow execution network |
| **One-liner** | Turn a goal and a budget into a multi-agent workflow. Agents buy data over **x402**, survive worker crashes via checkpoints, and are paid out by a **TaskEscrow contract on Monad** only for verified results. |
| **Live URL** | **https://synapse-blitz.vercel.app** · public replay of the recorded run: **https://synapse-blitz.vercel.app/replay** (no login) |
| **GitHub** | https://github.com/ShoaebMalik19/synapse-blitz |
| **Contract** | `TaskEscrow` **[`0x097dc98f0cfcb46d98569bac7f987c8e22359f10`](https://testnet.monadvision.com/address/0x097dc98f0cfcb46d98569bac7f987c8e22359f10)** |
| **Network** | **Monad Testnet** (chain id `10143`, `eip155:10143`), RPC `https://testnet-rpc.monad.xyz` |
| **Deployment** | Deploy tx [`0xfb76e035…f7c2`](https://testnet.monadvision.com/tx/0xfb76e03562258435e7d28b4436b92abdd6246450fe06f7d480cd57ae4f8cc7c2) · block `76873840` · record in [`deployments/monad-testnet.json`](deployments/monad-testnet.json) · frontend on Vercel |

---

## The problem

AI agents can already plan and call tools. They still can't **work for each other**:

* **No enforceable budgets.** An agent with a wallet can overspend; a prompt is not a spending limit.
* **No recovery.** When a worker dies mid-task, its work and any paid-for data are lost, or paid for twice.
* **No outcome-based payment.** There's no neutral way to pay a worker only when its result is accepted.

## The solution

Synapse is a workflow network where the money rules are deterministic code and on-chain contracts, not prompts.

1. **Plan.** An LLM planner (Groq `gpt-oss-20b`, rule-based fallback) proposes a task DAG. Zod and DAG checks validate it. **Nothing runs until the operator approves.**
2. **Commit.** On approval, `TaskEscrow.createTask` + `fundTask` lock MON on Monad against a spec hash.
3. **Pay per call.** Worker A hits a paid API, receives **HTTP 402**, and a **policy guard** (payee, asset, network, per-call cap, total cap, idempotency) decides *before signing* whether to pay. Payment settles in USDC on Monad.
4. **Crash and recover.** Worker A is killed mid-task. Its lease expires and **Worker B resumes from a hashed checkpoint without paying for the data again.**
5. **Verify and settle.** Deterministic checks verify the output. Worker B commits the result hash (`submitResult`), the requester accepts that exact hash (`acceptResult`), and **escrow pays out on Monad.**

```
goal + budget ─► planner (Groq / rule-based) ─► Zod + DAG validation ─► operator approval
      ─► TaskEscrow.createTask + fundTask (Monad) ─► Worker A: HTTP 402 → policy guard → x402 USDC payment
      ─► 💥 Worker A crashes ─► lease expiry ─► Worker B resumes from checkpoint (no second payment)
      ─► deterministic verification ─► submitResult(hash) → acceptResult(hash) ─► MON payout (Monad)
```

---

## Proof: one run, live on Monad testnet

Run **`wf_a4198e6b7d13412b`**: plan → escrow funded → x402 purchase settled → Worker A crashed → Worker B resumed from checkpoint → over-cap purchase rejected before signing → 3/3 tasks verified → escrow settled.

Watch it without installing anything: **https://synapse-blitz.vercel.app/replay**

| Step | Result | Monad testnet explorer |
|---|---|---|
| `TaskEscrow` deployed | ✅ block 76873840 | [`0x097dc98f…9f10`](https://testnet.monadvision.com/address/0x097dc98f0cfcb46d98569bac7f987c8e22359f10) |
| `TaskEscrow.createTask` | ✅ confirmed | [`0xd30522e9…26f348`](https://testnet.monadvision.com/tx/0xd30522e998a34ed66b190d0f8600f3a6a1f03d423508d8556bfe9b581c26f348) |
| `TaskEscrow.fundTask` (0.01 MON) | ✅ confirmed | [`0xd4e513b5…7d6d72`](https://testnet.monadvision.com/tx/0xd4e513b563a79778a000b034aac9f8cc7a6bec09cf4b50cb92ca98ac2a7d6d72) |
| x402 payment: 0.01 USDC → data provider (Transfer log + EIP-3009 nonce verified) | ✅ block 76881361 | [`0x47bd1a4f…8685a7`](https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7) |
| Over-cap x402 request (0.25 USDC > 0.02 cap) | ✅ **rejected before signing** | no tx, by design |
| Worker A crash → Worker B resumes from checkpoint | ✅ data purchase reused, **not paid twice** | see replay |
| `submitResult` (Worker B commits briefing hash) | ✅ confirmed | [`0x1f32f2c1…90f7a3`](https://testnet.monadvision.com/tx/0x1f32f2c11b5d2c8a6239a7dc039ba571e6ba7f5c85725256e554dfb2e990f7a3) |
| `acceptResult` → **escrow payout to Worker B** | ✅ `Settled`, +0.01 MON | [`0xaff7bd15…8971b2`](https://testnet.monadvision.com/tx/0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2) |

Full verification method: **[PAYMENT_VERIFICATION.md](PAYMENT_VERIFICATION.md)** · 3-minute demo script: **[DEMO.md](DEMO.md)** · design: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Why Monad

* **Per-task settlement is practical.** Fast, cheap EVM blocks make it reasonable to open, fund, commit and settle an escrow *per workflow*, not just per month. Each run includes a live probe of Monad block cadence and gas.
* **Public, checkable state.** Escrow terms, result hashes and settlement events are on-chain, so any requester, worker or judge can verify a payout independently.
* **Native x402 support.** USDC on Monad testnet supports EIP-3009, and a public x402 facilitator settles `exact` payments on `eip155:10143`.

**x402 ≠ escrow.** x402 pays for *data up front* (USDC). TaskEscrow pays the *worker on accepted outcome* (MON). They're separate budgets and are never converted into each other.

| On Monad testnet | Off-chain (Synapse) |
|---|---|
| `TaskEscrow`: requester, payee, verifier, deadline, spec hash, result hash, MON escrow, settle/refund events | LLM/rule-based planning, worker execution, raw outputs |
| x402 USDC settlement via facilitator (`transferWithAuthorization`) | Leases, heartbeats, checkpoints, retries, event log (SQLite WAL) |
| | Policy guard, output verification, artifacts + SHA-256 hashes |

Only 32-byte commitments go on-chain. Receipts prove **payment and settlement**, not the semantic quality of AI output.

---

## Features (all tested)

| Feature | Evidence |
|---|---|
| Goal + budget composer with separate USDC / MON limits and server-side ceilings | Playwright E2E |
| Groq planner (`openai/gpt-oss-20b`, OpenAI-compatible) with saved provenance; rule-based fallback on 429/401/timeouts/invalid output | `tests/unit/planner-llm.test.ts`; live drafts `wf_c85cd9229ef38b20`, `wf_07664bfb445539fd` |
| Zod-validated task DAG (cycles, unknown deps, capabilities, budget bounds) | `tests/unit/planner.test.ts` |
| Drafts have no side effects: no payments or escrow until **Approve & start** | `tests/unit/planner-llm.test.ts` |
| Two separate worker processes with atomic claims, leases, heartbeats, fencing, bounded retries | `tests/unit/scheduler.test.ts` |
| **Real crash failover**: Worker A exits (code 137) after a checkpoint; Worker B resumes from it | E2E + unit test asserting no side effect repeats |
| Deterministic x402 policy guard: allowlists, per-call cap, approval threshold, total cap, idempotency | `tests/unit/policy.test.ts`; live rejection of 0.25 USDC |
| x402 v2 resource server (`@x402/express`) on `eip155:10143` returning real HTTP 402 | live `PAYMENT-REQUIRED` header |
| x402 client: policy → EIP-3009 signature → facilitator settle → Transfer log verified on-chain | [tx `0x47bd1a4f…`](https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7) |
| EIP-3009 nonce reconciliation for unknown outcomes: never blindly re-pay | `tests/unit/payments.test.ts` |
| `TaskEscrow` contract | 21 Foundry tests, `contracts/test/TaskEscrow.t.sol` |
| Output verification: schema, citations, sections, links, hash, no unresolved payments | `tests/unit/security.test.ts` |
| Live DAG, event timeline, recovery timeline, payment ledger, briefing page, Markdown export | Playwright E2E (production build) |

If a dependency is missing, the exact operation shows as **BLOCKED with the reason**. Nothing is simulated or labeled settled without chain evidence.

---

## Tech stack

**Chain:** Monad testnet · Solidity + Foundry (`TaskEscrow`) · viem
**Payments:** x402 v2 (`@x402/express`, `@x402/fetch`, `@x402/evm`) · Circle testnet USDC (EIP-3009)
**App:** Next.js 16 · React 19 · Tailwind · React Flow (live DAG)
**Agents:** Groq `openai/gpt-oss-20b` via OpenAI-compatible API · Zod · Node worker processes · SQLite (WAL)
**Tests:** Foundry · Vitest · Playwright

---

## Setup

Requirements: Node 22+ (tested on 24), npm, [Foundry](https://getfoundry.sh) for contract tests.

```bash
git clone https://github.com/ShoaebMalik19/synapse-blitz.git
cd synapse-blitz
npm install
cp .env.example .env            # fill in values (see below)
npm run build
npm run start:all               # web :3000 + x402 service :4021 + orchestrator + Worker A + Worker B
# dev mode: npm run dev:all
```

Open http://localhost:3000 → **Launch Synapse** → sign in with `OPERATOR_ACCESS_TOKEN`.
Best run: http://localhost:3000/workflows/wf_a4198e6b7d13412b

### Configuration

| Variable | Purpose |
|---|---|
| `SESSION_SECRET`, `OPERATOR_ACCESS_TOKEN` | operator session (random values) |
| `OPERATOR_PRIVATE_KEY` | **testnet-only** wallet: deploys/funds escrow, signs x402 authorizations. Needs testnet MON + USDC |
| `WORKER_A_PRIVATE_KEY`, `WORKER_B_PRIVATE_KEY` | worker payee identities (Worker B submits the result hash) |
| `X402_PAY_TO` | address that receives x402 payments for the data service |
| `MONAD_ESCROW_ADDRESS` | `0x097dc98f0cfcb46d98569bac7f987c8e22359f10`, or written by `npm run deploy:escrow` |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional; verified with Groq (`https://api.groq.com/openai/v1`, `openai/gpt-oss-20b`). Without it the rule-based planner is used and labeled as such |

Testnet funds: MON from https://faucet.monad.xyz, USDC from https://faucet.circle.com (Monad Testnet).

```bash
npm run status          # chain id, balances, facilitator support (never prints keys)
npm run deploy:escrow   # deploy your own TaskEscrow → deployments/monad-testnet.json + .env
```

### Tests

```bash
npm run test:contracts  # 21 Foundry tests
npm test                # Vitest unit/integration tests
npm run typecheck && npm run lint && npm run build
npm run test:e2e        # Playwright (boots the full stack on :3100)
npm run smoke           # headless end-to-end run with a failure drill
```

---

## Verified configuration (2026-11-04)

* `eth_chainId` at `https://testnet-rpc.monad.xyz` → `0x279f` (10143)
* Testnet USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`: 6 decimals, EIP-712 `version()="2"`, EIP-3009 `authorizationState()` responds
* Facilitator `https://x402-facilitator.molandak.org/supported` lists `{scheme:"exact", network:"eip155:10143", x402Version:2}`
* Explorer: https://testnet.monadvision.com

## Known limitations

* The hosted site serves the UI and the public replay. Live runs need the full stack (x402 service, orchestrator, workers) running locally. The facilitator and all settlement are real Monad testnet infrastructure.
* Single-operator auth; the worker registry is a static allowlist, not a permissionless marketplace.
* Workers are separate OS processes sharing one SQLite DB on one machine (production: Postgres + networked workers).
* Escrow covers the final deliverable (payee = Worker B); per-node escrow is future work.
* No reputation, staking, slashing or dispute arbitration yet.

## Roadmap

Per-task escrow for every DAG node · permissionless worker registry with staking · networked workers · dispute/verifier markets · mainnet.

## Repository layout

```
contracts/            TaskEscrow.sol + Foundry tests
services/paid-data/   x402-gated Monad data service (Express + @x402/express)
src/server/           orchestrator, runtime, policy guard, x402 client, escrow adapter, planner, verification
src/app/              Next.js UI + API routes
public/replay/        static, read-only replay of run wf_a4198e6b7d13412b
scripts/              orchestrator / worker / supervisor processes, deploy, status, smoke
tests/                Vitest (unit) and Playwright (e2e)
deployments/          on-chain deployment records
```

---

_Built at Monad Blitz Mumbai [Devcon Edition]. Forked from [`monad-developers/monad-blitz-devcon-mumbai`](https://github.com/monad-developers/monad-blitz-devcon-mumbai); the organizer's submission instructions are preserved in [docs/BLITZ_SUBMISSION_PROCESS.md](docs/BLITZ_SUBMISSION_PROCESS.md)._
