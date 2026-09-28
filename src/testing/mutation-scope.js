const NON_RUNS = ["--help", "-h", "--version"];
const MUTATE_FLAGS = ["--mutate", "-m"];

function namesGlob(args) {
  return args.some(
    (arg, index) =>
      (MUTATE_FLAGS.includes(arg) && (args[index + 1] ?? "") !== "") ||
      (arg.startsWith("--mutate=") && arg !== "--mutate="),
  );
}

function reusesIncrementalReport(args) {
  return args.includes("--incremental") && !args.includes("--force");
}

export function fullRunRefusal(args, ci) {
  if (ci === "true" || args.some((arg) => NON_RUNS.includes(arg)) || namesGlob(args) || reusesIncrementalReport(args)) {
    return undefined;
  }
  return "refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`";
}
