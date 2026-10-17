const NON_RUNS: readonly string[] = ["--help", "-h", "--version"];
const MUTATE_FLAGS: readonly string[] = ["--mutate", "-m"];

function namesGlob(args: readonly string[]): boolean {
  return args.some(
    (arg, index) =>
      (MUTATE_FLAGS.includes(arg) && (args[index + 1] ?? "") !== "") ||
      (arg.startsWith("--mutate=") && arg !== "--mutate="),
  );
}

function allowedAnyway(args: readonly string[], ci: string): boolean {
  return ci === "true" || args.some((arg) => NON_RUNS.includes(arg)) || namesGlob(args);
}

export function fullRunRefusal(args: readonly string[], ci: string): string | undefined {
  if (allowedAnyway(args, ci) || (args.includes("--incremental") && !args.includes("--force"))) return undefined;
  return "refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`";
}

export function missingReportRefusal(
  args: readonly string[],
  ci: string,
  incrementalFile: string,
  reportExists: (path: string) => boolean,
): string | undefined {
  if (allowedAnyway(args, ci) || reportExists(incrementalFile)) return undefined;
  return `refusing a full mutation run outside CI: \`--incremental\` finds no report at ${incrementalFile} to reuse; scope this run with \`--mutate <glob>\`, or start the full baseline in CI with \`gh workflow run mutation\``;
}
