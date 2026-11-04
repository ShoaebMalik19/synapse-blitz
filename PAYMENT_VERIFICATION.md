# Payment & Settlement Verification

This file records **only** evidence that exists on-chain. Nothing here is simulated. Status values:
`CONFIRMED` (receipt + logs verified), `PENDING`, `BLOCKED` (could not be attempted, reason given), `REJECTED` (refused by policy before signing).

_Last updated: 2026-11-04._

## Networks and assets

| Item | Value | How verified |
|---|---|---|
| Network | Monad testnet, chain id **10143** (`eip155:10143`) | `eth_chainId` → `0x279f` at `https://testnet-rpc.monad.xyz` |
| x402 asset | Circle USDC (testnet) `0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimals | `decimals()`, `symbol()`, `version()="2"`, EIP-1967 admin slot, `authorizationState()` callable |
| x402 facilitator | `https://x402-facilitator.molandak.org` | `/supported` lists `exact` @ `eip155:10143`, `x402Version: 2` |
| x402 scheme | `exact` (EIP-3009 `transferWithAuthorization`) | `@x402/evm` 2.29.0 `ExactEvmScheme` |
| Escrow asset | native MON (testnet) | — |
| Explorer | https://testnet.monadvision.com | — |

## Wallets (dedicated, low-value, testnet-only)

| Role | Address |
|---|---|
| Operator (requester/verifier, x402 payer, deployer) | [`0x33D32B469efDcC765f1CfE84737A337e814faCf2`](https://testnet.monadvision.com/address/0x33D32B469efDcC765f1CfE84737A337e814faCf2) |
| Worker A payee | [`0x914dD6352906c22FFe5B290fBa1612F0E380Df54`](https://testnet.monadvision.com/address/0x914dD6352906c22FFe5B290fBa1612F0E380Df54) |
| Worker B payee (escrow payee) | [`0xFbb2dcb07A6513956E6ffd90Fb510627E09d9dA4`](https://testnet.monadvision.com/address/0xFbb2dcb07A6513956E6ffd90Fb510627E09d9dA4) |
| x402 provider `payTo` | [`0x6cCC8A2fB675ecf7b4324e334773b95843818787`](https://testnet.monadvision.com/address/0x6cCC8A2fB675ecf7b4324e334773b95843818787) |

## TaskEscrow

| Item | Status | Value |
|---|---|---|
| Contract tests | ✅ 21/21 passing (Foundry) | `contracts/test/TaskEscrow.t.sol` |
| Deployment | **BLOCKED** — operator wallet had 0 MON at last check (`npm run status`) | — |
| createTask / fundTask | **BLOCKED** (needs deployment + MON) | — |
| submitResult / acceptResult (settlement) | **BLOCKED** (needs funded escrow) | — |

## x402 payments

| Resource | Amount | Status | Tx | Notes |
|---|---|---|---|---|
| `GET /v1/monad/ecosystem` | 0.01 USDC (10000 base units) | **BLOCKED** | — | HTTP 402 received and policy approved; signing refused by preflight because payer holds 0 testnet USDC. Reservation released. |
| `GET /v1/monad/deep-dive` | 0.25 USDC (250000 base units) | **REJECTED** (by design) | — | Policy guard: exceeds per-call cap 0.02 USDC. Never signed. |

## Verification method

* **x402** — after the facilitator returns `PAYMENT-RESPONSE`, Synapse fetches the receipt for `transaction` from Monad RPC, requires `status=success` and a `Transfer(from=payer, to=payTo, value=amount)` log emitted by the configured USDC contract, and checks `authorizationState(payer, nonce) == true`. Only then is the payment `CONFIRMED`. Unknown outcomes are reconciled by nonce (`authorizationState`) and `AuthorizationUsed` logs — never by re-paying.
* **Escrow** — each action is sent at most once per workflow (`escrow_operations` unique on `(workflow, action)`); a broadcast tx is reconciled by receipt rather than re-sent. Settlement is accepted only if the receipt succeeded, a `TaskSettled` event for the task id is present, its `resultHash` equals the verified report hash, and `getTask(id).state == Settled`. The payee balance is read at the settlement block.

## How to reproduce

```bash
npm run status
npm run deploy:escrow        # records deployments/monad-testnet.json
npm run start:all            # then run a workflow from the dashboard
```

The per-workflow ledger (`/workflows/<id>` and `/api/workflows/<id>/payments`) lists every payment and escrow operation with tx hash, explorer link and verification JSON.
