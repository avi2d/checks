import { existsSync } from "node:fs";

const NON_RUNS = ["--help", "-h", "--version"];
const MUTATE_FLAGS = ["--mutate", "-m"];
const DEFAULT_INCREMENTAL_FILE = "reports/stryker-incremental.json";

function namesGlob(args) {
  return args.some(
    (arg, index) =>
      (MUTATE_FLAGS.includes(arg) && (args[index + 1] ?? "") !== "") ||
      (arg.startsWith("--mutate=") && arg !== "--mutate="),
  );
}

function incrementalFile(args) {
  const index = args.indexOf("--incrementalFile");
  if (index !== -1) return args[index + 1] ?? DEFAULT_INCREMENTAL_FILE;
  const inline = args.find((arg) => arg.startsWith("--incrementalFile="));
  return inline === undefined ? DEFAULT_INCREMENTAL_FILE : inline.slice("--incrementalFile=".length);
}

export function fullRunRefusal(args, ci, reportExists = existsSync) {
  if (ci === "true" || args.some((arg) => NON_RUNS.includes(arg)) || namesGlob(args)) return undefined;
  if (args.includes("--incremental") && !args.includes("--force")) {
    const report = incrementalFile(args);
    if (reportExists(report)) return undefined;
    return `refusing a full mutation run outside CI: \`--incremental\` finds no report at ${report} to reuse; download the main baseline report from the CI \`mutation-report\` artifact into ${report}, or scope this run with \`--mutate <glob>\``;
  }
  return "refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`";
}
