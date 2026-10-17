// src/testing/mutation-refusal.ts
var NON_RUNS = ["--help", "-h", "--version"];
var MUTATE_FLAGS = ["--mutate", "-m"];
function namesGlob(args) {
  return args.some((arg, index) => MUTATE_FLAGS.includes(arg) && (args[index + 1] ?? "") !== "" || arg.startsWith("--mutate=") && arg !== "--mutate=");
}
function allowedAnyway(args, ci) {
  return ci === "true" || args.some((arg) => NON_RUNS.includes(arg)) || namesGlob(args);
}
function fullRunRefusal(args, ci) {
  if (allowedAnyway(args, ci) || args.includes("--incremental") && !args.includes("--force"))
    return;
  return "refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`";
}
function missingReportRefusal(args, ci, incrementalFile, reportExists) {
  if (allowedAnyway(args, ci) || reportExists(incrementalFile))
    return;
  return `refusing a full mutation run outside CI: \`--incremental\` finds no report at ${incrementalFile} to reuse; scope this run with \`--mutate <glob>\`, or start the full baseline in CI with \`gh workflow run mutation\``;
}
export {
  fullRunRefusal,
  missingReportRefusal
};
