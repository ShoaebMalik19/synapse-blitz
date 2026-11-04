/** Deploy TaskEscrow to Monad testnet with the operator key; records artifacts and updates .env. */
import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import TaskEscrow from "../src/lib/contracts/TaskEscrow.json";
import { assertExpectedChain, publicClient, walletFor } from "../src/server/chain";
import { env, explorerAddress, explorerTx } from "../src/server/env";

async function main() {
  const pk = env().OPERATOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY missing in .env");
  const chainId = await assertExpectedChain();
  const w = walletFor(pk);
  const pc = publicClient();
  const bal = await pc.getBalance({ address: w.account.address });
  console.log(`chainId=${chainId} deployer=${w.account.address} balance=${bal} wei`);
  if (bal === 0n) throw new Error(`deployer has 0 MON — fund ${w.account.address} at https://faucet.monad.xyz`);
  const hash = await w.deployContract({ abi: TaskEscrow.abi, bytecode: TaskEscrow.bytecode as Hex, args: [] });
  console.log("deploy tx", hash);
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deployment failed: ${r.status}`);
  const code = await pc.getCode({ address: r.contractAddress });
  const record = {
    network: "monad-testnet",
    chainId,
    contract: "TaskEscrow",
    address: r.contractAddress,
    deployTx: hash,
    blockNumber: r.blockNumber.toString(),
    deployer: w.account.address,
    gasUsed: r.gasUsed.toString(),
    codeSize: code ? (code.length - 2) / 2 : 0,
    explorer: { contract: explorerAddress(r.contractAddress), tx: explorerTx(hash) },
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(path.join("deployments", "monad-testnet.json"), JSON.stringify(record, null, 2));
  const envPath = ".env";
  if (fs.existsSync(envPath)) {
    const s = fs.readFileSync(envPath, "utf8");
    fs.writeFileSync(envPath, s.match(/^MONAD_ESCROW_ADDRESS=.*$/m) ? s.replace(/^MONAD_ESCROW_ADDRESS=.*$/m, `MONAD_ESCROW_ADDRESS=${r.contractAddress}`) : s + `\nMONAD_ESCROW_ADDRESS=${r.contractAddress}\n`);
  }
  console.log(JSON.stringify(record, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
