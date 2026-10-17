import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "testing", "flake.ts");
const SEEDS = Array.from({ length: 12 }, (_, index) => index + 1);

const ORDER_DEPENDENT = `import { expect, test } from "bun:test";
let seeded = false;
test("seeds the cache", () => {
  seeded = true;
});
test("reads the cache", () => {
  expect(seeded).toBe(true);
});
`;
const ORDER_FREE = `import { expect, test } from "bun:test";
test("seeds the cache", () => {
  expect(new Map([["k", 1]]).get("k")).toBe(1);
});
test("reads the cache", () => {
  expect(new Map([["k", 1]]).has("k")).toBe(true);
});
`;

const FlakeRecord = Schema.fromJsonString(
  Schema.Struct({
    runs: Schema.Array(
      Schema.Struct({ seed: Schema.Int, passed: Schema.Boolean, tests: Schema.Int, failed: Schema.Array(Schema.String) }),
    ),
    failures: Schema.Array(
      Schema.Struct({ file: Schema.String, test: Schema.String, line: Schema.Int, seeds: Schema.Array(Schema.Int) }),
    ),
    outsideTests: Schema.Array(Schema.Int),
    parallel: Schema.optionalKey(
      Schema.Struct({
        workers: Schema.Int,
        replays: Schema.Array(Schema.Struct({ seed: Schema.Int, files: Schema.Array(Schema.String), command: Schema.String })),
      }),
    ),
  }),
);

const SINGLETON = `export const loads = process.title === "checks-flake-singleton" ? 2 : 1;
process.title = "checks-flake-singleton";
`;
const sharesSingleton = (name: string) => `import { expect, test } from "bun:test";
import { loads } from "./singleton.ts";

test("${name} loads the singleton once", () => {
  expect(loads).toBe(1);
});
`;
const OWN_PRELOAD = `import { expect, test } from "bun:test";

test("the repository's own preload ran", () => {
  expect(Reflect.get(globalThis, "setUp")).toBe(true);
});
`;

const scratch = scratchDirs();

let dir = "";

async function consumer(cache: string, scripts: Record<string, string> = {}): Promise<void> {
  dir = await scratch("checks-flake-");
  await mkdir(join(dir, "tests"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "consumer", scripts }));
  await writeFile(join(dir, "tests", "cache.test.ts"), cache);
  await writeFile(join(dir, "tests", "steady.test.ts"), `import { test } from "bun:test";\ntest("holds", () => {});\n`);
}

async function sharedSingleton(testScript: string): Promise<void> {
  dir = await scratch("checks-flake-");
  await mkdir(join(dir, "tests"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "consumer", scripts: { test: testScript } }));
  await writeFile(join(dir, "bunfig.toml"), '[test]\npreload = ["./tests/setup.ts"]\n');
  await writeFile(join(dir, "tests", "setup.ts"), 'Reflect.set(globalThis, "setUp", true);\n');
  await writeFile(join(dir, "tests", "singleton.ts"), SINGLETON);
  await writeFile(join(dir, "tests", "a.test.ts"), sharesSingleton("a"));
  await writeFile(join(dir, "tests", "b.test.ts"), sharesSingleton("b"));
  await writeFile(join(dir, "tests", "own-preload.test.ts"), OWN_PRELOAD);
}

async function flake(summaryFile: string): Promise<{ exitCode: number; text: string; record: typeof FlakeRecord.Type }> {
  const seeds = SEEDS.flatMap((seed) => ["--seed", String(seed)]);
  const result = await $`bun ${SCRIPT} ${seeds} --report flake-report.json`
    .cwd(dir)
    .env({ ...process.env, GITHUB_STEP_SUMMARY: summaryFile })
    .nothrow()
    .quiet();
  const record = Schema.decodeSync(FlakeRecord)(await readFile(join(dir, "flake-report.json"), "utf8"));
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString(), record };
}

async function expectEachReplayFails(caught: Awaited<ReturnType<typeof flake>>, seeds: readonly number[]): Promise<void> {
  const printed = [...caught.text.matchAll(/^- seed (\d+): `(.+)`$/gm)];
  expect(printed.map(([, seed, command]) => [Number(seed), command])).toEqual(
    (caught.record.parallel?.replays ?? []).map((replay) => [replay.seed, replay.command]),
  );
  expect(printed.map(([, seed]) => Number(seed))).toEqual([...seeds]);
  for (const [, seed, command] of printed) {
    const failing = caught.record.failures.filter((failure) => failure.seeds.includes(Number(seed)));
    expect(failing).toHaveLength(1);
    for (const attempt of [1, 2, 3]) {
      const replay = await $`bash -c ${command ?? ""}`.cwd(dir).nothrow().quiet();
      expect({ attempt, exitCode: replay.exitCode }).toEqual({ attempt, exitCode: 1 });
      expect(replay.stderr.toString()).toContain(`(fail) ${failing[0]?.test}`);
    }
  }
}

async function failsWithSeed(seed: number): Promise<boolean> {
  const result = await $`bun test --randomize --seed=${seed}`.cwd(dir).nothrow().quiet();
  return result.exitCode !== 0 && result.stderr.toString().includes("(fail) reads the cache");
}

test(
  "an order-dependent test is caught with every seed that reproduces it, and the fixed suite runs clean",
  async () => {
    await consumer(ORDER_DEPENDENT);
    const summaryFile = join(dir, "step-summary.md");
    const caught = await flake(summaryFile);
    expect(caught.exitCode).toBe(1);

    const [failure, ...others] = caught.record.failures;
    expect(others).toEqual([]);
    expect(failure).toMatchObject({ file: "tests/cache.test.ts", test: "reads the cache", line: 6 });
    const failing = failure?.seeds ?? [];
    const passing = SEEDS.filter((seed) => !failing.includes(seed));
    expect(failing.length).toBeGreaterThan(0);
    expect(passing.length).toBeGreaterThan(0);
    expect(caught.record.runs.filter((run) => !run.passed).map((run) => run.seed)).toEqual([...failing]);
    for (const seed of failing) expect(await failsWithSeed(seed)).toBe(true);
    for (const seed of passing) expect(await failsWithSeed(seed)).toBe(false);

    const row = `| tests/cache.test.ts:6 reads the cache | ${failing.length} of ${SEEDS.length} runs | ${failing.join(", ")} |`;
    expect(caught.text).toContain(`checks-flake: ${failing.length} of ${SEEDS.length} run(s) failed, 1 test(s) failing in them`);
    expect(caught.text).toContain(row);
    expect(await readFile(summaryFile, "utf8")).toContain(row);

    await writeFile(join(dir, "tests", "cache.test.ts"), ORDER_FREE);
    const clean = await flake(summaryFile);
    expect(clean.exitCode).toBe(0);
    expect(clean.record.failures).toEqual([]);
    expect(clean.text).toContain(`checks-flake: ${SEEDS.length} run(s) passed, with seeds ${SEEDS.join(", ")}`);
  },
  120_000,
);

test("a run that fails outside any test records its seed on its own", async () => {
  await consumer(ORDER_FREE);
  await writeFile(join(dir, "tests", "broken.test.ts"), `throw new Error("the module does not load");\n`);
  const broken = await flake(join(dir, "step-summary.md"));
  expect(broken.exitCode).toBe(1);
  expect(broken.record.failures).toEqual([]);
  expect(broken.record.outsideTests).toEqual(SEEDS);
  expect(broken.text).toContain(`${SEEDS.length} run(s) failed outside any test, with seeds ${SEEDS.join(", ")}`);
}, 120_000);

test(
  "under the test script's workers, a failing run prints a replay of its worker's files that fails the same test every time",
  async () => {
    await sharedSingleton("checks-test --parallel=1");
    const caught = await flake(join(dir, "step-summary.md"));
    expect(caught.exitCode).toBe(1);
    expect(caught.text).toContain(`checks-flake: ${SEEDS.length} of ${SEEDS.length} run(s) failed on 1 worker(s), `);
    expect(caught.text).not.toContain("only some of the time");
    expect(caught.record.failures.map((failure) => failure.file).sort()).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
    expect(caught.record.runs.every((run) => run.tests === 3 && run.failed.length === 1)).toBe(true);

    await expectEachReplayFails(caught, SEEDS);
  },
  120_000,
);

test(
  "under the test script's workers, a replay keeps the seed's order inside each file and fails an order-dependent test every time",
  async () => {
    await consumer(ORDER_DEPENDENT, { test: "checks-test --parallel=1" });
    const caught = await flake(join(dir, "step-summary.md"));
    expect(caught.exitCode).toBe(1);
    const [failure, ...others] = caught.record.failures;
    expect(others).toEqual([]);
    expect(failure).toMatchObject({ file: "tests/cache.test.ts", test: "reads the cache", line: 6 });
    expect(failure?.seeds.length).toBeGreaterThan(0);
    await expectEachReplayFails(caught, failure?.seeds ?? []);
  },
  120_000,
);

test("a test script without workers hunts serially, where the module loads once and the suite passes", async () => {
  await sharedSingleton("checks-test");
  const serial = await flake(join(dir, "step-summary.md"));
  expect(serial.exitCode).toBe(0);
  expect(serial.text).toContain(`checks-flake: ${SEEDS.length} run(s) passed, with seeds ${SEEDS.join(", ")}`);
  expect(Object.keys(serial.record)).toEqual(["runs", "failures", "outsideTests"]);
}, 120_000);
