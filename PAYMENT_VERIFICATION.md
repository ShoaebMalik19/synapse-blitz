# Payment & Settlement Verification

This file records **only** evidence that exists on-chain. Nothing here is simulated. Status values:
`CONFIRMED` (receipt + logs verified), `PENDING`, `BLOCKED` (could not be attempted, reason given), `REJECTED` (refused by policy before signing).

_Last updated: 2026-11-04 (final, after funded x402 run)._

## Final status

| Flow | Status | Proof (best run `wf_a4198e6b7d13412b`) |
|---|---|---|
| **x402** (USDC, `exact`, eip155:10143) | ✅ **CONFIRMED** — 1 payment of 0.01 USDC, verified against receipt + `Transfer` log + EIP-3009 nonce | [`0x47bd1a4f…8685a7`](https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7) |
| **TaskEscrow** (native MON) | ✅ **CONFIRMED** — funded 0.01 MON, settled to Worker B, `TaskSettled` hash = verified briefing | [`0xaff7bd15…8971b2`](https://testnet.monadvision.com/tx/0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2) |
| Over-cap x402 request (0.25 USDC) | ✅ **REJECTED** by policy before signing (in every run) | — |

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
| Contract | ✅ **CONFIRMED** deployed | [`0x097dc98f0cfcb46d98569bac7f987c8e22359f10`](https://testnet.monadvision.com/address/0x097dc98f0cfcb46d98569bac7f987c8e22359f10) |
| Deployment tx | ✅ **CONFIRMED** block 76873840, gas 903,220, code size 3,766 B | [`0xfb76e035…8cc7c2`](https://testnet.monadvision.com/tx/0xfb76e03562258435e7d28b4436b92abdd6246450fe06f7d480cd57ae4f8cc7c2) |

Operator funding: 0.5 MON received (MetaMask transfer from `0x65036…e53b3`), verified on-chain via `eth_getBalance` before deployment.

### Workflow `wf_a4198e6b7d13412b` — best run: x402 + failover + escrow settlement ✅

Funding before the run: operator held 20 testnet USDC (`balanceOf` on `0x534b…43A3`, chain 10143) and ~0.29 MON. Failure drill on; limits unchanged (x402 cap 0.05 USDC, per-call 0.02, approval threshold 0.015, escrow 0.01 MON, gas ≤ 0.05 MON).

| Action | Status | Block | Tx |
|---|---|---|---|
| `createTask` | CONFIRMED | 76881320 | [`0xd30522e9…26f348`](https://testnet.monadvision.com/tx/0xd30522e998a34ed66b190d0f8600f3a6a1f03d423508d8556bfe9b581c26f348) |
| `fundTask` (0.01 MON) | CONFIRMED | 76881328 | [`0xd4e513b5…7d6d72`](https://testnet.monadvision.com/tx/0xd4e513b563a79778a000b034aac9f8cc7a6bec09cf4b50cb92ca98ac2a7d6d72) |
| **x402** `GET /v1/monad/ecosystem` — 0.01 USDC | CONFIRMED | 76881361 | [`0x47bd1a4f…8685a7`](https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7) |
| x402 `GET /v1/monad/deep-dive` — 0.25 USDC | REJECTED before signing (exceeds 0.02 per-call cap) | — | — |
| `submitResult` (Worker B) | CONFIRMED | 76881475 | [`0x1f32f2c1…90f7a3`](https://testnet.monadvision.com/tx/0x1f32f2c11b5d2c8a6239a7dc039ba571e6ba7f5c85725256e554dfb2e990f7a3) |
| `acceptResult` → **escrow payout** | CONFIRMED | 76881480 | [`0xaff7bd15…8971b2`](https://testnet.monadvision.com/tx/0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2) |

x402 verification (read independently from Monad RPC, not from the provider):
* Receipt `status 0x1`, submitted by the facilitator signer `0x95d181c4…4304c`.
* Exactly one `Transfer` log from the USDC contract `0x534b2f3A…43A3`: from operator `0x33D3…faCf2` to payTo `0x6cCC…8787`, value **10000** (0.01 USDC).
* `authorizationState(operator, nonce) == true` (EIP-3009 authorization consumed).
* Balances after the run: operator 20 → **19.99** USDC, payTo **0.01** USDC total — exactly one purchase has ever settled.

Recovery: Worker A purchased the dataset, saved checkpoint seq 1 (`purchase_dataset`, payment op id recorded), then the injected fault terminated its process. The lease expired; Worker B claimed recovery attempt #2, loaded checkpoint seq 1 (state hash verified), **skipped `purchase_dataset`**, and completed the remaining steps. No second x402 authorization was signed.

Escrow verification: receipt `success`; `TaskSettled` found, 10000000000000000 wei; event result hash `0x9a431f2c75d43bdf30755f29edc27b89f53576b9c5326ebd11a75251b70c86ed` = the verified briefing artifact hash; `getTask().state == Settled`; Worker B 0.045647648 → 0.055647648 MON at the settlement block (+0.01 MON). Briefing verification: research 8/8, analysis 7/7, synthesis 9/9 checks.

### Workflow `wf_01246f8c91c04819` — escrow settled; x402 not attempted ✅/⚠️

The paid data service returned HTTP 500 on the first request (its startup call to the facilitator timed out), so no x402 authorization was created; the run continued with public sources. Fixed afterwards (facilitator warm-up + one probe retry). Escrow settled cleanly:

Rule-based planner · failure drill: Worker A crashed after checkpoint 1 · Worker B resumed from the checkpoint and completed all tasks. No manual steps.
On-chain spec hash `0xfc738752…b7700797` = SHA-256 of the validated plan.

| Action | Status | Block | Tx |
|---|---|---|---|
| `createTask` | CONFIRMED | 76875435 | [`0xa0352f4d…753852`](https://testnet.monadvision.com/tx/0xa0352f4d923e0eae7376c43b847fde98fbfc616a4e89ae29555c257812753852) |
| `fundTask` (0.01 MON) | CONFIRMED | 76875440 | [`0xe388ed73…500ad9`](https://testnet.monadvision.com/tx/0xe388ed7317c5f7b72c8eea6d153bc17dc83addffcd2ffa610881c88d73500ad9) |
| `submitResult` (Worker B) | CONFIRMED | 76875538 | [`0xba24f8c6…454fe6`](https://testnet.monadvision.com/tx/0xba24f8c6e74128f370769568199f96384592babd01b6ef94914489a3c2454fe6) |
| `acceptResult` → **settlement** | CONFIRMED | 76875545 | [`0x5f631295…aaba9c`](https://testnet.monadvision.com/tx/0x5f631295b1deed583ad6c9478e2024a32bd18b2bdc6d1142f91e0293feaaba9c) |

Settlement verification (receipt + event logs + contract state): receipt `success`; `TaskSettled` event found, amount 10000000000000000 wei; event result hash `0xca538b6069e4c344fb404fdda18266244bf6f64310c0b078adbd2b585ed5e540` **equals** the verified briefing artifact hash; `getTask().state == Settled`; payee `0xFbb2…9dA4` balance 0.041123824 → 0.051123824 MON at the settlement block (+0.01 MON).

### Workflow `wf_2ac61fd5c046ed65` — first run, settled after fixes ⚠️ (disclosed)

| Action | Status | Block | Tx |
|---|---|---|---|
| `createTask` | CONFIRMED | 76873914 | [`0xa3df6876…e00f52`](https://testnet.monadvision.com/tx/0xa3df68768215b0a3ffc605c5c7261c28c6c61c6d5faf1f02112853435ce00f52) |
| `fundTask` (0.01 MON) | CONFIRMED | 76873917 | [`0x0931e1e0…514e6c`](https://testnet.monadvision.com/tx/0x0931e1e072ca8ae94af51c4b2b52e94a589613bb11c474ab89afb3fa57514e6c) |
| Gas top-up → Worker B (0.01 MON) | CONFIRMED | 76874010 | [`0x8677aef4…b83046`](https://testnet.monadvision.com/tx/0x8677aef4b8a4dc6cab4be95154681370a096c6334647568c275abb098fb83046) |
| Gas top-up 2 → Worker B (0.009649808 MON) | CONFIRMED | 76874791 | [`0xfdc9e1ff…07e7b4`](https://testnet.monadvision.com/tx/0xfdc9e1ff1b4de2af60a8c8d8aa02f6efec3416dd227648ba4dd2b520de07e7b4) |
| `submitResult` (Worker B) — **broadcast manually**, note 1 | CONFIRMED | 76874970 | [`0x0fec6cf2…c4c0ac`](https://testnet.monadvision.com/tx/0x0fec6cf2c1488a3a3abdfc3aced792f7fb61e877e15b5cca8cdaa28aa7c4c0ac) |
| Gas top-up 3 → Worker B (0.022426368 MON) — **unnecessary**, note 2 | CONFIRMED | 76875094 | [`0x7ac391e1…eb7706`](https://testnet.monadvision.com/tx/0x7ac391e1884d06aa0797849efcc3f356b7c3b776543083c81a308c7489eb7706) |
| `acceptResult` → **settlement** | CONFIRMED | 76875103 | [`0x1e6ce9b7…786fe8`](https://testnet.monadvision.com/tx/0x1e6ce9b738b05f680d70fa6af5dbc8ddd02d825f2615634145ba54591d786fe8) |

Settlement verified the same way: `TaskSettled` found, result hash `0x2cec3cc7515d35a1042bbe844a3d5caef5d9e236e9df6e902842dc4776c825d7` equals the briefing artifact, state `Settled`, payee +0.01 MON.

Notes (what went wrong and what changed):
1. The app's `submitResult` was rejected by the RPC with "Signer had insufficient balance" and never broadcast. While diagnosing, the **identical app-signed transaction** (nonce 0) was submitted directly via `eth_sendRawTransaction` and was accepted. The app's ledger was reconciled by receipt (no new transaction was created). The same signed tx being rejected and then accepted points to a load-balanced RPC node with a stale state view. **Fix:** escrow sends retry transient rejections; the fixed nonce guarantees at most one inclusion.
2. The settlement retry sent top-up 3 although the submit was already broadcast. All top-ups stayed within the workflow's 0.05 MON gas allowance and went to Synapse's own Worker B wallet, but the top-up was unnecessary. **Fix:** top-ups happen only when a new submit will actually be signed, sized from the live gas estimate × maxFee.
3. A settlement interrupted by a process restart could stay stuck in `SETTLING`. **Fix:** the orchestrator marks such workflows `FAILED` (retryable) on startup; retries reconcile broadcast txs by receipt.

## x402 payments (all runs)

| Run | Resource | Amount | Final status | Tx |
|---|---|---|---|---|
| `wf_a4198e6b7d13412b` | `GET /v1/monad/ecosystem` | 0.01 USDC | ✅ **CONFIRMED** (on-chain verified) | [`0x47bd1a4f…8685a7`](https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7) |
| `wf_a4198e6b7d13412b` | `GET /v1/monad/deep-dive` | 0.25 USDC | **REJECTED** — per-call cap, never signed | — |
| `wf_01246f8c91c04819` | `GET /v1/monad/ecosystem` | — | **NOT ATTEMPTED** — provider HTTP 500 (facilitator unreachable at service start) | — |
| `wf_01246f8c91c04819` | `GET /v1/monad/deep-dive` | 0.25 USDC | **REJECTED** — never signed | — |
| `wf_2ac61fd5c046ed65` | `GET /v1/monad/ecosystem` | 0.01 USDC | **BLOCKED · NOT CHARGED** — operator held 0 USDC at the time; no authorization signed; reservation released | — |
| `wf_2ac61fd5c046ed65` | `GET /v1/monad/deep-dive` | 0.25 USDC | **REJECTED** — never signed | — |

No payment outcome was ever UNKNOWN, so no reconciliation was needed; the reconciliation path (EIP-3009 `authorizationState` + `AuthorizationUsed` logs) is covered by unit tests.

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
