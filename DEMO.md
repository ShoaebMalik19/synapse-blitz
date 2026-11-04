# Synapse — Demo

Best run: **`wf_a4198e6b7d13412b`** — x402 payment settled, Worker A crashed, Worker B resumed from checkpoint, escrow paid out. Everything below is already on Monad testnet; the demo replays it, no live spending required.

## Setup (once)

```bash
npm run start:all     # web :3000 + x402 data service :4021 + orchestrator + Worker A + Worker B
```

Have the `OPERATOR_ACCESS_TOKEN` from `.env` ready. Optionally keep the terminal visible to show both worker processes.

## Click-by-click walkthrough

1. **Login** — open http://localhost:3000/dashboard → you are redirected to `/login` → paste the operator token → **Sign in**.
2. **Dashboard** — point at *Network & wallet* (chain `10143 = expected`, TaskEscrow deployed, facilitator `exact @ eip155:10143`) and *Worker registry* (Worker A and Worker B **ONLINE**, separate processes).
3. **Workflow history** — under *Recent workflows*, click **wf_a4198e6b7d13412b** (direct: http://localhost:3000/workflows/wf_a4198e6b7d13412b).
4. **Stat cards** — `x402 confirmed 0.01 USDC`, `Escrow 0.0100 MON · SETTLED`, `Recoveries 1`.
5. **Live event timeline** (right) — scroll to show, in order: `HTTP 402` → `Policy approved and reserved 0.01 USDC` → `x402 payment settled on Monad testnet and verified (USDC Transfer log matched)` → red **`Injected failure: Worker A … terminating`** → `lease expired`.
6. **Recovery timeline** (bottom left) — attempt **#1 worker-a FAILED** (lease expired, checkpoint `cp1: purchase_dataset`), attempt **#2 RECOVERY worker-b SUCCEEDED**, *resumed from cp_… (seq 1)*, then cp2–cp6. The purchase step was not repeated.
7. **Payment & settlement ledger** (bottom right) —
   * `/v1/monad/ecosystem 0.01 USDC` **PAID · VERIFIED ON-CHAIN**, `✓ Transfer log verified @ block 76881361` → click the **tx** link.
   * `/v1/monad/deep-dive 0.25 USDC` (struck through) **REJECTED · NOT SIGNED** — over the 0.02 per-call cap.
   * Escrow `CREATE`, `FUND 0.0100 MON`, `SUBMIT`, `ACCEPT` — all **CONFIRMED** with tx links.
8. **Briefing** — click **View briefing** (top right): cited Markdown report; sidebar shows *all verification checks passed*, on-chain state **Settled**, *result hash on-chain = report artifact*, cost breakdown, worker history with the RECOVERY attempt.
9. **Download Markdown** — the file includes the x402 settlement tx under *Data Provenance*.
10. **Explorer proof** — click the `ACCEPT` tx (settlement) and the x402 tx in the ledger. Explorer links (the explorer may show a short browser check first):
    * x402 payment: https://testnet.monadvision.com/tx/0x47bd1a4f8ba3e42121652a0d6dcc5f766ecf4bba8fe16014eba25258e28685a7
    * escrow payout: https://testnet.monadvision.com/tx/0xaff7bd15a6b72c624c1959c41f49b4839b198034adb8b6aa06f3343ff28971b2

## 60-second presenter script

* **0–10 s** — "Synapse lets agents plan, pay, recover and get paid — with on-chain proof. One goal, one budget: USDC for data, MON for escrow, kept separate."
* **10–20 s** — *(workflow page)* "The plan was validated deterministically, then a TaskEscrow commitment was created and funded on Monad."
* **20–30 s** — *(timeline + ledger)* "Worker A hit a paid API, got HTTP 402, our policy guard approved one cent, and the payment settled — we verified the USDC Transfer log on-chain. It also tried a 25-cent purchase; the guard rejected it before signing."
* **30–42 s** — *(recovery timeline)* "Then we killed Worker A mid-task. Its lease expired, Worker B loaded the saved checkpoint and continued — without buying the data again. One purchase, ever."
* **42–52 s** — *(briefing page)* "Every task passed deterministic checks. Worker B committed the briefing hash on-chain and the requester accepted that exact hash — escrow paid out. The on-chain hash matches this report."
* **52–60 s** — *(explorer)* "Here are both transactions on Monad testnet. Plan, pay, fail, recover, verify, settle."

## Running a fresh workflow (optional, spends testnet funds)

Dashboard → **Generate plan** → keep **Failure drill** checked → **Approve & start**. Takes ~70 s. Spends ≤0.01 USDC (x402) and 0.01 MON escrow + gas from the operator wallet.

If something external is down, the UI never fakes success: the affected operation is shown as **BLOCKED · NOT CHARGED** with the exact reason, and failover, verification and the report still work. Earlier runs `wf_01246f8c91c04819` (escrow settled; x402 not attempted — provider returned HTTP 500 at startup) and `wf_2ac61fd5c046ed65` (escrow settled, x402 blocked — no USDC then) remain in history as examples.
