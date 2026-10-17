import { existsSync } from "node:fs";

const NON_RUNS = ["--help", "-h", "--version"];
const MUTATE_FLAGS = ["--mutate", "-m"];

function namesGlob(args) {
  return args.some(
    (arg, index) =>
      (MUTATE_FLAGS.includes(arg) && (args[index + 1] ?? "") !== "") ||
      (arg.startsWith("--mutate=") && arg !== "--mutate="),
  );
}

function allowedAnyway(args, ci) {
  return ci === "true" || args.some((arg) => NON_RUNS.includes(arg)) || namesGlob(args);
}

export function fullRunRefusal(args, ci) {
  if (allowedAnyway(args, ci) || (args.includes("--incremental") && !args.includes("--force"))) return undefined;
  return "refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`";
}

// Only the resolved options know the incrementalFile a consumer config sets, so this runs after config load.
export function missingReportRefusal(args, ci, incrementalFile, reportExists = existsSync) {
  if (allowedAnyway(args, ci) || reportExists(incrementalFile)) return undefined;
  return `refusing a full mutation run outside CI: \`--incremental\` finds no report at ${incrementalFile} to reuse; scope this run with \`--mutate <glob>\`, or start the full baseline in CI with \`gh workflow run mutation\``;
}
