# Synapse — Decentralized Agent Workflow Execution Network

> Monad Blitz (Devcon Mumbai) submission · hackathon prototype · **testnet only**

Synapse turns a **goal + budget** into a verified multi-agent workflow. An AI planner proposes a task DAG, deterministic code validates it, **independent worker processes** execute the tasks, an agent **buys data over x402**, a **Monad `TaskEscrow` contract** commits and settles the deliverable, and when a worker dies mid-task another worker **resumes from a hashed checkpoint without paying twice**.

```
goal + budget ─► planner (LLM or rule-based) ─► Zod + DAG validation ─► operator approval
      ─► TaskEscrow.createTask + fundTask (Monad) ─► Worker A: x402 purchase → sources → checkpoints
      ─► 💥 crash ─► lease expiry ─► Worker B resumes from checkpoint ─► analysis ─► briefing
      ─► deterministic verification ─► submitResult(hash) → acceptResult(hash) (Monad) ─► report + evidence
```

## Why it matters

Agents can plan and call tools, but cross-operator agent work lacks **enforceable budgets, portable checkpoints and outcome-based payment**. Synapse demonstrates all three in one vertical slice:

* **Why Monad** — fast, cheap EVM blocks make *per-task* commitments and settlement practical for agent workflows (a live probe in each run measures block cadence and gas on Monad testnet). Escrow state, result hashes and settlement events are public and independently checkable.
* **Why x402** — metered HTTP purchases with a standard 402 handshake. The agent pays per request with an EIP-3009 authorization; a facilitator settles on-chain. Synapse puts a **deterministic policy guard between the 402 and the signature**.
* **x402 ≠ escrow.** x402 pays for data *up front* (USDC). TaskEscrow pays the worker *on accepted outcome* (MON). They are separate budgets and are never converted into each other.

## What runs where

| On Monad testnet (chain 10143) | Off-chain (Synapse) |
|---|---|
| `TaskEscrow`: task id, requester, payee, verifier, deadline, spec hash, result hash, native-MON escrow, settle/refund events | LLM/rule-based planning, prompts, worker execution, raw outputs |
| x402 USDC settlement via facilitator (`transferWithAuthorization`) | Leases, heartbeats, checkpoints, retries, event log (SQLite, WAL) |
| | Policy guard, output verification, artifacts (+ SHA-256 hashes) |

Large outputs never go on-chain; only 32-byte commitments do. On-chain receipts prove **payment and settlement**, not the semantic quality of AI output.

## Actual working features (tested)

| Feature | Status | Evidence |
|---|---|---|
| Goal + budget composer, separate USDC / MON limits, server ceilings | ✅ | UI + `budgets above server ceilings are rejected` E2E |
| Planner → Zod-validated DAG (cycles, unknown deps, capabilities, budget, bounds) | ✅ | `tests/unit/planner.test.ts` |
| Two distinct worker processes (Worker A research, Worker B analysis/synthesis + research backup) | ✅ | separate OS processes, heartbeats in registry |
| Atomic claims, leases, heartbeats, fencing, timeouts, bounded retries | ✅ | `tests/unit/scheduler.test.ts` |
| **Real crash failover**: Worker A process exits (code 137) after a checkpoint; Worker B resumes from it | ✅ | E2E + unit test asserts no side effect repeated |
| Deterministic policy guard (payee/asset/network/scheme allowlist, per-call cap, approval threshold, total cap, idempotency) | ✅ | `tests/unit/policy.test.ts`; live run rejects the 0.25 USDC deep-dive **before signing** |
| x402 v2 resource server (`@x402/express`) on `eip155:10143` returning real HTTP 402 | ✅ | live `PAYMENT-REQUIRED` header from the service |
| x402 client: policy → EIP-3009 signature → facilitator settle → **Transfer log verified on-chain** | ⚠️ implemented; live settlement **pending wallet USDC** | see [PAYMENT_VERIFICATION.md](PAYMENT_VERIFICATION.md) |
| EIP-3009 nonce reconciliation for unknown outcomes (never blind re-pay) | ✅ | `tests/unit/payments.test.ts` |
| `TaskEscrow` contract | ✅ 21 Foundry tests | `contracts/test/TaskEscrow.t.sol` |
| TaskEscrow deploy + create/fund/submit/accept with receipt + event + state verification | ⚠️ implemented; live deployment **pending wallet MON** | see [PAYMENT_VERIFICATION.md](PAYMENT_VERIFICATION.md) |
| Deterministic output verification (schema, citations, sections, links, hash, no unresolved payments) | ✅ | `tests/unit/security.test.ts` |
| Live DAG, event timeline, recovery timeline, payment ledger, result page, Markdown download | ✅ | Playwright E2E (real Chrome, production build) |

When a dependency is missing, the exact operation is shown as **BLOCKED with the reason** (e.g. `payer … has 0 base units of testnet USDC`). Nothing is simulated or labeled as settled without chain evidence.

## Quick start (local)

Requirements: Node 22+ (tested on 24), npm, [Foundry](https://getfoundry.sh) for contract tests.

```bash
npm install
cp .env.example .env            # then fill in values (see below)
npm run build
npm run start:all               # web :3000 + x402 service :4021 + orchestrator + Worker A + Worker B
# dev mode instead: npm run dev:all
```

Open http://localhost:3000 → **Launch Synapse** → sign in with `OPERATOR_ACCESS_TOKEN`.

### Required configuration

| Variable | Purpose |
|---|---|
| `SESSION_SECRET`, `OPERATOR_ACCESS_TOKEN` | operator session (random values) |
| `OPERATOR_PRIVATE_KEY` | **testnet-only** wallet: deploys/funds escrow, signs x402 authorizations. Needs testnet MON + testnet USDC |
| `WORKER_A_PRIVATE_KEY`, `WORKER_B_PRIVATE_KEY` | worker payee identities (Worker B submits the result hash; operator tops it up with ≤0.01 MON gas) |
| `X402_PAY_TO` | address that receives x402 payments for the data service |
| `MONAD_ESCROW_ADDRESS` | written by `npm run deploy:escrow` |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional OpenAI-compatible LLM. Without it the **rule-based planner/analyst** is used and labeled in the UI |

Funding (testnet only): MON from https://faucet.monad.xyz, USDC from https://faucet.circle.com (Monad Testnet). Then:

```bash
npm run status          # chain id, wallet balances, facilitator support (never prints keys)
npm run deploy:escrow   # deploys TaskEscrow, writes deployments/monad-testnet.json and .env
```

### Tests

```bash
npm run test:contracts  # 21 Foundry tests
npm test                # 36 Vitest unit/integration tests
npm run typecheck && npm run lint && npm run build
npm run test:e2e        # Playwright (uses installed Chrome; boots the full stack on :3100)
npm run smoke           # headless end-to-end run with a failure drill against running backend
```

## How to demo

See **[DEMO.md](DEMO.md)** (3-minute script). Architecture details: **[ARCHITECTURE.md](ARCHITECTURE.md)**. Payment/settlement evidence: **[PAYMENT_VERIFICATION.md](PAYMENT_VERIFICATION.md)**.

## Verified configuration (feasibility gate, 2026-11-04)

* `eth_chainId` at `https://testnet-rpc.monad.xyz` → `0x279f` (10143).
* Testnet USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`: `decimals()=6`, `symbol()=USDC`, EIP-712 `version()="2"`, Circle FiatToken proxy, `authorizationState()` responds (EIP-3009).
* Facilitator `https://x402-facilitator.molandak.org/supported` lists `{scheme:"exact", network:"eip155:10143", x402Version:2}`.
* `@x402/*` 2.29.0; the SDK's default asset table maps `eip155:10143` to the same USDC address.
* Explorer: https://testnet.monadvision.com.

## Known limitations

* **Live on-chain evidence is pending funding** of the dedicated testnet wallet — see PAYMENT_VERIFICATION.md for current status.
* Single-operator auth model; prototype worker registry is a static allowlist (not a permissionless marketplace).
* Workers share one SQLite database on one machine (separate processes, not separate hosts). Production would use Postgres + network workers.
* Escrow covers the final deliverable (payee = Worker B); per-task escrow for every node is future work.
* Workers are not sandboxed; research sources are a fixed allowlist.
* No reputation, staking, slashing or dispute arbitration (explicitly out of scope).
* Windows note: this host blocks native SWC, so builds use Webpack (`next build --webpack`).

## Repository layout

```
contracts/            TaskEscrow.sol + Foundry tests
services/paid-data/   x402-gated Monad data service (Express + @x402/express)
src/server/           orchestrator, runtime, policy, x402 client, escrow adapter, planner, verification
src/app/              Next.js UI + API routes
scripts/              orchestrator / worker / supervisor processes, deploy, status, smoke
tests/unit, tests/e2e Vitest and Playwright suites
deployments/          deployment records (written by deploy script)
```

_Built for Monad Blitz Devcon Mumbai. This repository is a fork of `monad-developers/monad-blitz-devcon-mumbai`; the organizer's original submission instructions are preserved in [docs/BLITZ_SUBMISSION_PROCESS.md](docs/BLITZ_SUBMISSION_PROCESS.md)._
