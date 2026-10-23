import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, ran, UNVENDORED_BUNFIG } from "./lib/fixture-repo.ts";
import { fakeActions } from "./lib/fake-actions.ts";

const STRYKER_CONFIG = `import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
  bun: {
    ...preset.bun,
    testFiles: unitTestFiles(),
  },
};
`;

const WIDGET_TEST = `import { expect, test } from "bun:test";
import { widget } from "../../widget.ts";

test("widget", () => {
  expect(widget).toBe(42);
});
`;

const widgetTest = (name: string, wait: string) => `import { expect, test } from "bun:test";
import { widget } from "../../widget.ts";

test("${name}", async () => {
  ${wait}
  expect(widget).toBe(42);
});
`;

const operandTest = (name: string) => `import { expect, test } from "bun:test";
import { ${name} } from "../../${name}.ts";

test("${name}", () => {
  expect(${name}).toBe(42);
});
`;

const reusedOf = (text: string): readonly [reused: number, total: number] | undefined => {
  const matched = /(\d+) of (\d+) mutant result\(s\) are reused/.exec(text);
  return matched === null ? undefined : [Number(matched[1]), Number(matched[2])];
};

type Report = {
  readonly files: Readonly<Record<string, { readonly mutants: ReadonlyArray<{ readonly replacement: string; readonly static?: boolean; readonly status: string; readonly killedBy?: ReadonlyArray<string> }> }>>;
  readonly testFiles: Readonly<Record<string, { readonly tests: ReadonlyArray<{ readonly id: string }> }>>;
};

let packDir = "";
let dir = "";

beforeAll(async () => {
  packDir = await mkdtemp(join(tmpdir(), "checks-stryker-pack-"));
  const tarball = (await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet()).stdout.toString().trim();
  dir = await mkdtemp(join(tmpdir(), "checks-stryker-consumer-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-stryker-fixture",
      type: "module",
      devDependencies: {
        "@avi2dg/checks": `file:${tarball}`,
        "@hughescr/stryker-bun-runner": "1.4.0",
        "@stryker-mutator/core": "10.0.0",
        "@types/bun": "1.4.2",
        effect: "4.0.0",
      },
    }),
  );
  await $`bun install`.cwd(dir).quiet();
}, 360_000);

afterAll(async () => {
  for (const one of [dir, packDir]) if (one) await rm(one, { recursive: true, force: true });
}, 60_000);

test(
  "packed-tarball consumer runs bunx stryker under Node through the installed preset and kills the one mutant",
  async () => {
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "widget.ts"), "export const widget = 40 + 2;\n");
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), WIDGET_TEST);

    const result = await ran($`bunx stryker run --mutate widget.ts --reporters clear-text`.cwd(dir));
    expect(result.text).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    expect(result.text).toMatch(/widget\.ts\s*\|\s*100\.00\s*\|/);
    expect(result.exitCode).toBe(0);
  },
  180_000,
);

test(
  "a run with bail records a static mutant's killer from the unit test file that runs fastest, though another sorts first by path",
  async () => {
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "widget.ts"), "export const widget = 40 + 2;\n");
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "a-slow.test.ts"), widgetTest("slow widget", "await Bun.sleep(1000);"));
    await writeFile(join(dir, "tests", "unit", "b-fast.test.ts"), widgetTest("fast widget", ""));

    const result = await ran($`bunx stryker run --mutate widget.ts --reporters json`.cwd(dir));
    expect(result.exitCode).toBe(0);
    const report: Report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).json();
    const fastIds = report.testFiles["tests/unit/b-fast.test.ts"]?.tests.map((one) => one.id) ?? [];
    const mutants = report.files["widget.ts"]?.mutants ?? [];
    expect(mutants.length).toBeGreaterThan(0);
    for (const mutant of mutants) {
      expect(mutant).toMatchObject({ static: true, status: "Killed" });
      expect(mutant.killedBy).toEqual(fastIds);
    }
  },
  180_000,
);

test(
  "an incremental baseline reuses the unchanged file results and reruns only the changed file, counted from the fixture full run",
  async () => {
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "alpha.ts"), "export const alpha = 40 + 2;\n");
    await writeFile(join(dir, "beta.ts"), "export const beta = 20 + 22;\n");
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "alpha.test.ts"), operandTest("alpha"));
    await writeFile(join(dir, "tests", "unit", "beta.test.ts"), operandTest("beta"));
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    expect(full.text).not.toContain("mutant result(s) are reused");
    const counted: Report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).json();
    const alphaMutants = counted.files["alpha.ts"]?.mutants ?? [];
    const betaMutants = counted.files["beta.ts"]?.mutants ?? [];
    expect(alphaMutants.length).toBeGreaterThan(0);
    expect(betaMutants.length).toBeGreaterThan(0);
    const total = alphaMutants.length + betaMutants.length;

    const same = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(same.exitCode).toBe(0);
    expect(reusedOf(same.text)).toEqual([total, total]);

    await writeFile(join(dir, "alpha.ts"), "export const alpha = 41 + 1;\n");
    const changed = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(changed.exitCode).toBe(0);
    expect(reusedOf(changed.text)).toEqual([betaMutants.length, total]);
  },
  480_000,
);

// Ordinary arithmetic is the oracle: 38 is not 42, so strengthening the helper must flip the static mutant from Survived to Killed.
const PROBE_TEST = `import { expect, test } from "bun:test";
import { check } from "../../helper.ts";
import { widget } from "../../widget.ts";

test("widget", () => {
  expect(check(widget)).toBe(true);
});
`;

async function committedBase(files: readonly string[]): Promise<string> {
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git add ${files}`.cwd(dir).quiet();
  await $`git -c user.email=fixture@example.com -c user.name=Fixture commit -qm base`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

async function restoredFull(report: string, state: string, sha: string): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "checks-stryker-restore-"));
  try {
    const fake = await fakeActions(home, 4242, [
      {
        databaseId: 35,
        event: "workflow_dispatch",
        createdAt: "2026-10-03T12:00:00Z",
        headSha: sha,
        artifacts: [{ id: 350, name: "mutation-baseline-full", expired: false, files: { "mutation.json": report, "stryker-incremental.json": state } }],
      },
    ]);
    const restored = await ran(
      $`bun ${join(CHECKOUT, "src", "testing", "mutation-baseline.ts")} --full reports/mutation/mutation.json reports/stryker-incremental.json`.cwd(dir).env({
        ...process.env,
        CI: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
        GITHUB_RUN_ID: undefined,
        GITHUB_REPOSITORY_ID: "4242",
        ...fake.env,
        HOME: home,
      }),
    );
    expect(restored.exitCode).toBe(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test(
  "a pruned full state reruns a static mutant when its helper assertion strengthens from > 0 to === 42",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "widget.ts"), "export const widget = 40 + 2;\n");
    await writeFile(join(dir, "helper.ts"), "export const check = (n: number): boolean => n > 0;\n");
    await rm(join(dir, "alpha.ts"), { force: true });
    await rm(join(dir, "beta.ts"), { force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), PROBE_TEST);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(["bunfig.toml", "stryker.conf.mjs", "package.json", "widget.ts", "helper.ts", "tests/unit/widget.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = JSON.parse(state) as Report;
    expect((probe.files["widget.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Survived")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "helper.ts"), "export const check = (n: number): boolean => n === 42;\n");
    await $`git add helper.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm strengthen`.cwd(dir).quiet();
    await restoredFull(report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport: Report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).json();
    const mutants = rerunReport.files["widget.ts"]?.mutants ?? [];
    expect(mutants.length).toBeGreaterThan(0);
    for (const mutant of mutants) expect(mutant.status).toBe("Killed");
  },
  480_000,
);

test(
  "a pruned full state reruns a changed source file instead of reusing its killer",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "f.ts"), "export function f(x: number): number {\n  const v = x + 2;\n  return v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(["bunfig.toml", "stryker.conf.mjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = JSON.parse(state) as Report;
    expect((probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Killed")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "f.ts"), "export function f(x: number): number {\n  const v = x + 2;\n  return Math.abs(v);\n}\n");
    await $`git add f.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm absolute`.cwd(dir).quiet();
    await restoredFull(report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport: Report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).json();
    const mutants = rerunReport.files["f.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Survived");
  },
  480_000,
);
