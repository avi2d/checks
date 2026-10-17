import { appendFileSync } from "node:fs";

const log = process.env["CHECKS_FLAKE_WORKER_LOG"];
if (log !== undefined) appendFileSync(log, `${JSON.stringify({ worker: process.pid, file: Bun.main })}\n`);
