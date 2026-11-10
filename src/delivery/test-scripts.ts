import { Effect, FileSystem, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { KIT_PACKAGE_NAME, TEST_FILE, hasTierTests, kitScriptsToBin, ownTierCommand, scriptFaults, STANDARD_TIERS, tierCommand, type ScriptFault, type TestTier } from "../core/test-script.ts";

class TestScriptsError extends Schema.TaggedError<TestScriptsError>()("TestScriptsError", {
  message: Schema.String,
}) {}

export type MutableRecord = Record<string, unknown>;

const tierHasTests = Effect.fn("tierHasTests")(function* (root: string, tier: TestTier) {
  const listed = yield* workingTreeFiles(root).pipe(Effect.orElseSucceed(() => undefined));
  if (listed !== undefined) return hasTierTests(listed, tier);
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(root, "tests", tier);
  if (!(yield* system.exists(dir))) return false;
  const entries = yield* system.readDirectory(dir, { recursive: true }).pipe(
    Effect.mapError((cause) => new TestScriptsError({ message: "cannot read " + dir + ": " + cause.message })),
  );
  return entries.some((entry) => TEST_FILE.test(entry));
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

export type TestScriptContext = {
  readonly present: ReadonlySet<TestTier>;
  readonly isKit: boolean;
};

export const readTestScriptContext = Effect.fn("readTestScriptContext")(function* (root: string, knownName: unknown) {
  const present = new Set<TestTier>();
  for (const tier of STANDARD_TIERS) {
    if (yield* tierHasTests(root, tier)) present.add(tier);
  }
  return { present, isKit: knownName === KIT_PACKAGE_NAME } satisfies TestScriptContext;
});

export function testScriptsFault(scripts: MutableRecord, context: TestScriptContext): string | undefined {
  const effective = context.isKit ? kitScriptsToBin(scripts) : scripts;
  const fault = scriptFaults(effective, (tier) => context.present.has(tier)).find((candidate) => candidate.found !== undefined);
  return fault === undefined ? undefined : `package.json ${describeFault(fault)}`;
}

export function withTierDefaults(scripts: MutableRecord, context: TestScriptContext): MutableRecord {
  const next: MutableRecord = { ...scripts };
  for (const tier of STANDARD_TIERS) {
    const key = `test:${tier}`;
    if (typeof next[key] !== "string" && context.present.has(tier)) next[key] = context.isKit ? ownTierCommand(tier) : tierCommand(tier);
  }
  return next;
}
