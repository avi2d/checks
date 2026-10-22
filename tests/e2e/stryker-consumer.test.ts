import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, ran, UNVENDORED_BUNFIG } from "./lib/fixture-repo.ts";

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
  readonly files: Readonly<Record<string, { readonly mutants: ReadonlyArray<{ readonly static?: boolean; readonly status: string; readonly killedBy?: ReadonlyArray<string> }> }>>;
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
