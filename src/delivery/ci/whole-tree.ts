import { Config, Data, Effect, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { TestTier } from "../../core/test-script.ts";
import { scanTestFiles, selectedTierFile } from "../../testing/test-skips.ts";
import { commandPasses } from "./lib/run.ts";

class WholeTreeStepError extends Data.TaggedError("WholeTreeStepError")<{ readonly message: string }> {}

const LONG_TIERS = ["live", "pixel"] as const satisfies readonly TestTier[];
const TESTS_DIR = "reports/whole-tree-run-tests";
const GATES_DIR = "reports/whole-tree-run-gates";
const GATES_LOG = `${GATES_DIR}/gates.log`;
const MUTATION_REPORT = "reports/mutation/mutation-baseline-full/mutation.json";

const junitOf = (tier: TestTier): string => `${TESTS_DIR}/${tier}.xml`;

const tiersWithTests = Effect.gen(function* () {
  const files = yield* scanTestFiles(process.cwd());
  return LONG_TIERS.filter((tier) => files.some((file) => selectedTierFile(file, tier)));
});

const combinedOutput = Effect.fn("combinedOutput")(
  function* (program: string, args: readonly string[]) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(program, args, { stdin: "ignore" }));
    const [text] = yield* Effect.all([handle.all.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode], { concurrency: "unbounded" });
    return text;
  },
  Effect.scoped,
);

// The upload keeps an artifact for the report job to download even when no tier has tests.
const tests = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(TESTS_DIR, { recursive: true });
  yield* fs.writeFileString(`${TESTS_DIR}/manifest.txt`, "ready\n");
  for (const tier of yield* tiersWithTests) yield* commandPasses("bunx", ["checks-test", `--tier=${tier}`, `--junit=${junitOf(tier)}`]);
  return true;
});

const gates = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(GATES_DIR, { recursive: true });
  yield* fs.writeFileString(GATES_LOG, yield* combinedOutput("bunx", ["checks-lint", "--whole-tree"]));
  return true;
});

const report = Effect.gen(function* () {
  const gatesResult = yield* Config.String("GATES_RESULT");
  const testReports = (yield* tiersWithTests).flatMap((tier) => ["--tests", junitOf(tier)]);
  const gatesLog = gatesResult === "success" ? ["--gates", GATES_LOG] : [];
  return yield* commandPasses("bunx", ["checks-whole-tree-run", "--mutation", MUTATION_REPORT, ...testReports, ...gatesLog]);
});

const PARTS = { tests, gates, report };

const isPart = (part: string): part is keyof typeof PARTS => Object.hasOwn(PARTS, part);

export const main = Effect.fn("whole-tree")(function* (part: string | undefined) {
  if (part === undefined || !isPart(part)) {
    return yield* new WholeTreeStepError({ message: `checks-ci whole-tree takes one of ${Object.keys(PARTS).join(", ")}, not ${part ?? "nothing"}` });
  }
  return yield* PARTS[part];
});
