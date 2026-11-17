import { Console, Data, Effect } from "effect";
import { optionalInput } from "./lib/inputs.ts";
import { commandOutput } from "./lib/run.ts";
import { writeOutputs } from "./lib/step-output.ts";

class ChangesError extends Data.TaggedError("ChangesError")<{ readonly message: string }> {}

// tests/pixel and tests/quarantine stay outside, since a change there needs the whole run.
const ORDINARY_TEST = /^tests\/(?:unit|e2e)\/.+\.tsx?$/;

export function testsOnly(changed: readonly string[]): boolean {
  return changed.length > 0 && changed.every((path) => ORDINARY_TEST.test(path));
}

function docsOnlyVerdict(kitStdout: string): boolean {
  return kitStdout.split("\n").includes("docs-only=true");
}

const git = Effect.fn("git")(function* (...args: readonly string[]) {
  const { stdout, passed } = yield* commandOutput("git", args);
  if (!passed) return yield* new ChangesError({ message: `git ${args.join(" ")} failed` });
  return stdout;
});

const changedPaths = Effect.fn("changedPaths")(function* (base: string) {
  const mergeBase = (yield* git("merge-base", base, "HEAD")).trim();
  // Without --no-renames a test moved out of src/ would list only its new path.
  const listed = yield* git("-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", mergeBase, "HEAD");
  return listed.split("\n").filter((path) => path !== "");
});

export const main = Effect.gen(function* () {
  const base = yield* optionalInput("BASE_SHA");
  if (base === "") {
    yield* Console.log("changes: no base commit, so the full run stays");
    yield* writeOutputs({ "docs-only": "false", "tests-only": "false" });
    return true;
  }
  const kit = yield* commandOutput("bunx", ["checks-docs-only", base, "HEAD"]);
  if (!kit.passed) return yield* new ChangesError({ message: "checks-docs-only failed" });
  const docsOnly = docsOnlyVerdict(kit.stdout);
  const changed = yield* changedPaths(base);
  const onlyTests = !docsOnly && testsOnly(changed);
  yield* Console.log(`changes: ${changed.length} changed file(s), docs-only=${docsOnly}, tests-only=${onlyTests}`);
  yield* writeOutputs({ "docs-only": String(docsOnly), "tests-only": String(onlyTests) });
  return true;
});
