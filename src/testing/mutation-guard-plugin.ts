import { existsSync } from "node:fs";
import { missingReportRefusal } from "./mutation-scope.ts";

export const GUARD_IGNORER = "checks-incremental-report-guard";

function incrementalReportGuard(options: { readonly incrementalFile: string }): { readonly shouldIgnore: () => undefined } {
  const refusal = missingReportRefusal(process.argv.slice(3), process.env.CI ?? "", options.incrementalFile, existsSync);
  if (refusal !== undefined) throw new Error(refusal);
  return { shouldIgnore: () => undefined };
}

export const strykerPlugins = [
  { kind: "Ignore", name: GUARD_IGNORER, factory: Object.assign(incrementalReportGuard, { inject: ["options"] as const }) },
];
