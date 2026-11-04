# Synapse Architecture

## Processes

```
┌──────────────┐  HTTP (typed JSON, session cookie)  ┌────────────────────────────┐
│  Browser UI  │ ──────────────────────────────────► │ Next.js app (:3000)        │
│  (React,     │ ◄────────── polling 1.5s ────────── │  route handlers: read/write│
│  React Flow) │                                      │  SQLite, never sign txs    │
└──────────────┘                                      │  except retry-settlement   │
                                                      └─────────────┬──────────────┘
                                                                    │ SQLite (WAL, busy_timeout)
          ┌─────────────────────────┬───────────────────────────────┼─────────────────────────┐
          ▼                         ▼                               ▼                         ▼
┌───────────────────┐   ┌──────────────────────┐       ┌──────────────────────┐   ┌──────────────────────┐
│ Orchestrator      │   │ Worker A (process)   │       │ Worker B (process)   │   │ x402 data service    │
│ - promote READY   │   │ research             │       │ analysis, synthesis  │   │ (:4021, Express +    │
│ - expire leases   │   │ claims / leases /    │       │ backup: research     │   │  @x402/express)      │
│ - derive status   │   │ heartbeats / ckpts   │       │ (checkpoint resume)  │   │ HTTP 402 → facilitator│
│ - escrow lifecycle│   │ x402 purchases ──────┼──────────────────────────────────►│ verify + settle      │
│ - reconcile pays  │   └──────────────────────┘       └──────────────────────┘   └──────────┬───────────┘
└────────┬──────────┘   (each worker runs under a supervisor that restarts it after a crash)  │
         │ viem                                                                               │
         ▼                                                                                    ▼
   Monad testnet: TaskEscrow (createTask, fundTask, submitResult, acceptResult)     Facilitator (molandak) →
                                                                                   USDC.transferWithAuthorization
```

## Data model (SQLite, `src/server/db.ts`)

| Table | Purpose |
|---|---|
| `workflows` | goal, status, planner label, plan JSON + SHA-256 plan hash (= on-chain spec hash), budget (base units), settlement status |
| `workflow_tasks` | DAG nodes: deps, eligible + backup workers, costs, retry/timeout bounds, status, lease, current attempt (fencing token), result hash |
| `task_attempts` | every attempt: worker, kind (INITIAL/RETRY/RECOVERY), resumed checkpoint, failure reason |
| `task_checkpoints` | schema version, completed steps, state JSON + state hash, artifact ids, payment op ids |
| `workflow_events` | append-only event log rendered as the live timeline |
| `payment_operations` | x402 ops keyed by **idempotency key**: amount (base units), network, asset, payTo, status, EIP-3009 nonce, tx hash, on-chain verification |
| `escrow_operations` | one row per (workflow, action) → exactly-once CREATE/FUND/GAS_TOPUP/SUBMIT/ACCEPT, tx hash, block, verification |
| `artifacts` | outputs + verification reports with SHA-256 |
| `fault_injections` | armed/fired crash drills |

Workflow state is derived from task rows (`deriveStatus`). All writes from a worker are fenced by `current_attempt_id`, so a stale or crashed attempt can never complete a task.

## Task lifecycle

`CREATED → READY → CLAIMED → RUNNING ⇄ CHECKPOINTED → VERIFYING → COMPLETED`
Failures: lease expiry / error / verification failure → attempt `FAILED` → task `RECOVERING` (checkpoint exists) or `READY` (retry), or `FAILED` once `retryLimit` is exhausted (downstream tasks → `CANCELLED`, workflow → `FAILED`).

Recovery claims prefer a different online worker than the one that failed. Worker B may claim `research` **only** in `RECOVERING` state (backup capability).

## Failure recovery

1. Operator arms a fault (`POST /api/workflows/:id/inject-failure` or the approval-time drill).
2. Worker A saves a checkpoint (`saveCheckpoint` persists steps/state/payment ids + state hash).
3. The armed fault fires inside `saveCheckpoint`; the worker **process exits with code 137** — no cleanup, no lease release.
4. Orchestrator sees `lease_expires_at < now` → attempt `FAILED (lease expired)` → task `RECOVERING`.
5. Worker B claims a `RECOVERY` attempt, verifies the checkpoint state hash, and skips completed steps.
6. Paid steps are never repeated: the checkpoint carries the payment op id and the x402 client's idempotency key returns the stored artifact (`REUSED`). If a payment outcome is unknown, it is reconciled on-chain first (EIP-3009 `authorizationState`).
7. The supervisor restarts Worker A after 15 s; it does not take the task back while Worker B is online.

## Policy guard (`src/server/policy.ts`)

`reservePayment()` runs in a SQLite transaction:

* idempotency key already used and not failed → `DUPLICATE` (no new charge)
* provider + resource path allowlisted; `payTo` equals the allowlisted address
* `scheme=exact`, `network=X402_NETWORK_ID`, `asset=X402_ASSET_ADDRESS`
* amount ≤ per-call cap, ≤ task max cost, committed + amount ≤ x402 budget
* amount > approval threshold requires operator pre-approval
* rejected requests are recorded as `REJECTED` and never signed

Status vocabulary: `RESERVED → SUBMITTED → CONFIRMED` (only after an on-chain `Transfer(payer→payTo, amount)` log from the USDC contract is found), `RELEASED`, `FAILED`, `UNKNOWN` (reconcile before anything else), `REJECTED`.

## x402 flow (`src/server/x402pay.ts`)

1. `GET` resource without payment → HTTP 402 + `PAYMENT-REQUIRED` (x402 v2).
2. Parse with `x402HTTPClient.getPaymentRequiredResponse`.
3. Policy reservation (above).
4. USDC balance preflight (never sign what can't be covered).
5. `createPaymentPayload` → EIP-3009 `TransferWithAuthorization` signed by the operator key; authorization + nonce persisted **before** sending.
6. Retry with `PAYMENT-SIGNATURE`; facilitator verifies + settles.
7. Decode `PAYMENT-RESPONSE`; fetch the receipt from Monad RPC; require the matching `Transfer` log; mark `CONFIRMED` with explorer link.

## TaskEscrow (`contracts/src/TaskEscrow.sol`)

* `createTask(id, payee, verifier, deadline, specHash)` → `fundTask(id){value}` → `submitResult(id, resultHash)` (payee) → `acceptResult(id, expectedResultHash)` (requester/verifier) → payout to payee.
* `rejectResult` returns to `Funded`; `refundExpiredTask` only from `Funded` after deadline; `cancelTask` only from `Created`.
* No owner, no admin withdrawal; CEI + reentrancy lock on every transfer; acceptance bound to the exact submitted hash.
* Synapse uses `specHash = SHA-256(plan)` and `resultHash = SHA-256(final briefing artifact)`, so the UI can show the on-chain hash equals the delivered report.

Off-chain verification (`src/server/verify.ts`) runs before `submitResult`; only verified results become eligible for acceptance.

## Security notes

* Private keys live only in server-side env; the browser never receives them. No endpoint accepts client-supplied destinations, amounts, RPC URLs or keys.
* Every signing path calls `assertExpectedChain()` (RPC chain id must equal `MONAD_CHAIN_ID`).
* All mutating routes require the HMAC-signed operator session and ownership of the workflow.
* LLM output is schema-validated and can only *propose* tasks; workers, URLs, payees and amounts are chosen by code.
