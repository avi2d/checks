import { missingReportRefusal } from "./mutation-scope.js";

export const GUARD_IGNORER = "checks-incremental-report-guard";

// An ignorer is built before instrumentation from the resolved options, so a throw here stops the run before any mutant.
function incrementalReportGuard(options) {
  const refusal = missingReportRefusal(process.argv.slice(3), process.env.CI ?? "", options.incrementalFile);
  if (refusal !== undefined) throw new Error(refusal);
  return { shouldIgnore: () => undefined };
}
incrementalReportGuard.inject = ["options"];

export const strykerPlugins = [{ kind: "Ignore", name: GUARD_IGNORER, factory: incrementalReportGuard }];
