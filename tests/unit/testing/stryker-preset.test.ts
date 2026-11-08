import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BunTestRunner } from "@hughescr/stryker-bun-runner";
import { Schema } from "effect";

const presetUrl = new URL("../../../stryker.preset.js", import.meta.url).href;
const preset: unknown = (await import(presetUrl)).default;
const { ignoresStatic, mutationConcurrency, unitTestFiles }: {
  ignoresStatic: (mode: string | undefined) => boolean;
  mutationConcurrency: (environment: string | undefined, cores: number) => number;
  unitTestFiles: () => Array<string>;
} = await import(presetUrl);

const Manifest = Schema.fromJsonString(
  Schema.Struct({ exports: Schema.Record(Schema.String, Schema.Unknown) }),
);

test("the preset carries exactly the agreed rollout settings, the full-run guard and the unit tests", () => {
  expect(preset).toEqual({
    packageManager: "npm",
    plugins: [
      "@stryker-mutator/*",
      "@hughescr/stryker-bun-runner",
      fileURLToPath(new URL("../../../dist/mutation/mutation-guard-plugin.js", import.meta.url)),
    ],
    ignorers: ["checks-incremental-report-guard"],
    testRunner: "bun",
    bun: { timeout: 60000, testFiles: expect.arrayContaining(["tests/unit/testing/stryker-preset.test.ts"]) },
    inPlace: true,
    tempDirName: "../.stryker-tmp",
    coverageAnalysis: "perTest",
    reporters: ["html", "json", "clear-text", "progress"],
    timeoutMS: 60000,
    concurrency: expect.any(Number),
    ignoreStatic: expect.any(Boolean),
    thresholds: { high: 85, low: 70, break: null },
  });
});

test("mutation concurrency takes every core of a GitHub-hosted runner rather than half of them", () => {
  expect(mutationConcurrency("github-hosted", 4)).toBe(4);
  expect(mutationConcurrency("github-hosted", 1)).toBe(1);
});

test("mutation concurrency off a GitHub-hosted runner halves the cores, rounds down, and never drops below one", () => {
  expect(mutationConcurrency("self-hosted", 4)).toBe(2);
  expect(mutationConcurrency(undefined, 16)).toBe(8);
  expect(mutationConcurrency("", 7)).toBe(3);
  expect(mutationConcurrency("self-hosted", 2)).toBe(1);
  expect(mutationConcurrency(undefined, 1)).toBe(1);
});

test("static mutants are ignored only in a refresh run, not in a baseline, a compare or a local run", () => {
  expect(ignoresStatic("refresh")).toBe(true);
  expect(ignoresStatic("baseline")).toBe(false);
  expect(ignoresStatic("compare")).toBe(false);
  expect(ignoresStatic("Refresh")).toBe(false);
  expect(ignoresStatic(undefined)).toBe(false);
});

const coveringFiles = async (testFiles: ReadonlyArray<string>, testId: string): Promise<unknown> => {
  const enabled = () => false;
  const quiet = () => {};
  const logger: ConstructorParameters<typeof BunTestRunner>[0] = {
    isTraceEnabled: enabled,
    isDebugEnabled: enabled,
    isInfoEnabled: enabled,
    isWarnEnabled: enabled,
    isErrorEnabled: enabled,
    isFatalEnabled: enabled,
    trace: quiet,
    debug: quiet,
    info: quiet,
    warn: quiet,
    error: quiet,
    fatal: quiet,
  };
  // The runner reads only bun and mutate from the options, and StrykerOptions declares every other Stryker setting as required.
  const runner: BunTestRunner = Reflect.construct(BunTestRunner, [logger, { bun: { testFiles } }]);
  runner["cachedTestFiles"] = await runner["getOrDiscoverTestFiles"]();
  return runner["resolveCoveringTestFiles"]([testId]);
};

test("unitTestFiles lists every repository unit test with no leading ./, so a new file joins on its own", () => {
  const files = unitTestFiles();
  expect(files).toContain("tests/unit/testing/stryker-preset.test.ts");
  expect(files.filter((file) => !file.startsWith("tests/unit/"))).toEqual([]);
});

test("unitTestFiles paths are what resolveCoveringTestFiles at @hughescr/stryker-bun-runner/dist/index.js:8451 matches, and the directory form is not", async () => {
  const testId = "tests/unit/testing/stryker-preset.test.ts > the preset spreads that cap to every consumer";
  expect(await coveringFiles(unitTestFiles(), testId)).toEqual(["tests/unit/testing/stryker-preset.test.ts"]);
  expect(await coveringFiles(["./tests/unit/"], testId)).toBeUndefined();
  expect(await coveringFiles(["./tests/unit/testing/stryker-preset.test.ts"], testId)).toBeUndefined();
});

test("unitTestFiles walks nested groups, sorts, and skips files that are not unit tests", () => {
  const repository = mkdtempSync(join(tmpdir(), "unit-test-files-"));
  const original = process.cwd();
  try {
    mkdirSync(join(repository, "tests/unit/group"), { recursive: true });
    mkdirSync(join(repository, "tests/e2e"));
    for (const name of ["b.test.ts", "a.test.tsx", "notes.ts", "c.spec.ts", "group/d.test.ts"]) {
      writeFileSync(join(repository, "tests/unit", name), "");
    }
    writeFileSync(join(repository, "tests/e2e/e.test.ts"), "");
    process.chdir(repository);
    expect(unitTestFiles()).toEqual(["tests/unit/a.test.tsx", "tests/unit/b.test.ts", "tests/unit/group/d.test.ts"]);
  } finally {
    process.chdir(original);
    rmSync(repository, { recursive: true, force: true });
  }
});

test("unitTestFiles lists nothing rather than throwing in a repository without tests/unit", () => {
  const repository = mkdtempSync(join(tmpdir(), "unit-test-files-"));
  const original = process.cwd();
  try {
    process.chdir(repository);
    expect(unitTestFiles()).toEqual([]);
  } finally {
    process.chdir(original);
    rmSync(repository, { recursive: true, force: true });
  }
});

test("the preset is exported at its own path the way every other shared artifact is exposed", async () => {
  const manifest = Schema.decodeSync(Manifest)(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  expect(manifest.exports["./stryker.preset.js"]).toBe("./stryker.preset.js");
});
