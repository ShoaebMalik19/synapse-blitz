/** Minimal supervisor: restarts a crashed worker process after a delay (like a node operator's process manager). */
import { spawn } from "node:child_process";

const workerId = process.argv[2];
const RESTART_MS = Number(process.env.WORKER_RESTART_MS ?? 15000);

function start() {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts", workerId], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => {
    console.log(`[supervisor:${workerId}] worker exited code=${code}; restarting in ${RESTART_MS}ms`);
    setTimeout(start, RESTART_MS);
  });
}
start();
