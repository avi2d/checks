import { Effect, FileSystem, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { scriptFaults, STANDARD_TIERS, tierCommand, type ScriptFault, type TestTier } from "../core/test-script.ts";

class TestScriptsError extends Schema.TaggedError<TestScriptsError>()("TestScriptsError", {
  message: Schema.String,
}) {}

export type MutableRecord = Record<string, unknown>;

const TIER_TEST_FILE = /(?:[.](?:test|spec)|_test)[.](tsx?)$/;

const tierHasTests = Effect.fn("tierHasTests")(function* (root: string, tier: TestTier) {
  const prefix = `tests/${tier}/`;
  const listed = yield* workingTreeFiles(root).pipe(Effect.orElseSucceed(() => undefined));
  if (listed !== undefined) return listed.some((entry) => entry.startsWith(prefix) && TIER_TEST_FILE.test(entry));
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(root, "tests", tier);
  if (!(yield* system.exists(dir))) return false;
  const entries = yield* system.readDirectory(dir, { recursive: true }).pipe(
    Effect.mapError((cause) => new TestScriptsError({ message: "cannot read " + dir + ": " + cause.message })),
  );
  return entries.some((entry) => TIER_TEST_FILE.test(entry));
});

const describeFault = (fault: ScriptFault): string => {
  switch (fault.kind) {
    case "test":
      return `scripts.test must be "${fault.expected}", found ${JSON.stringify(fault.found ?? null)}`;
    case "fast":
      return `scripts["test:fast"] must be "${fault.expected}", found ${JSON.stringify(fault.found ?? null)}`;
    case "tier":
      return `scripts["${fault.key}"] must be "${fault.expected}", found ${JSON.stringify(fault.found ?? null)}`;
    case "empty-tier":
      return `scripts["${fault.key}"] names a tier with no test files, so remove it, found ${JSON.stringify(fault.found)}`;
    case "stray":
      return `scripts["${fault.key}"] is not a standard test script, so remove it, found ${JSON.stringify(fault.found)}`;
  }
};

export const testScriptsFault = Effect.fn("testScriptsFault")(function* (scripts: MutableRecord, root: string) {
  const present: TestTier[] = [];
  for (const tier of STANDARD_TIERS) {
    if (yield* tierHasTests(root, tier)) present.push(tier);
  }
  const fault = scriptFaults(scripts, (tier) => present.includes(tier)).find((candidate) => candidate.found !== undefined);
  return fault === undefined ? undefined : `package.json ${describeFault(fault)}`;
});

export const withTierDefaults = Effect.fn("withTierDefaults")(function* (scripts: MutableRecord, root: string) {
  const next: MutableRecord = { ...scripts };
  for (const tier of STANDARD_TIERS) {
    const key = `test:${tier}`;
    if (typeof next[key] !== "string" && (yield* tierHasTests(root, tier))) next[key] = tierCommand(tier);
  }
  return next;
});
