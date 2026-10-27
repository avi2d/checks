import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ran, UNVENDORED_BUNFIG } from "../e2e/lib/fixture-repo.ts";
import { committedBase, operandTest, PROBE_TEST, readReport, readState, removeConsumer, restoredFull, reusedOf, STRYKER_CONFIG, unpackConsumer, widgetTest, WIDGET_TEST } from "../e2e/lib/stryker-consumer.ts";

let packDir = "";
let dir = "";

beforeAll(async () => {
  const consumer = await unpackConsumer();
  packDir = consumer.packDir;
  dir = consumer.dir;
}, 360_000);

afterAll(async () => {
  await removeConsumer([dir, packDir]);
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
    const report = await readReport(join(dir, "reports", "mutation", "mutation.json"));
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
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "f.ts"), { force: true });
    await rm(join(dir, "h.ts"), { force: true });
    await rm(join(dir, "dual.ts"), { force: true });
    await rm(join(dir, "dual.js"), { force: true });
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await rm(join(dir, "settings"), { recursive: true, force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await rm(join(dir, "stryker.conf.cjs"), { force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "alpha.ts"), "export const alpha = 40 + 2;\n");
    await writeFile(join(dir, "beta.ts"), "export const beta = 20 + 22;\n");
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "alpha.test.ts"), operandTest("alpha"));
    await writeFile(join(dir, "tests", "unit", "beta.test.ts"), operandTest("beta"));
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "alpha.ts", "beta.ts", "tests/unit/alpha.test.ts", "tests/unit/beta.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    expect(full.text).not.toContain("mutant result(s) are reused");
    const counted = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const alphaMutants = counted.files["alpha.ts"]?.mutants ?? [];
    const betaMutants = counted.files["beta.ts"]?.mutants ?? [];
    expect(alphaMutants.length).toBeGreaterThan(0);
    expect(betaMutants.length).toBeGreaterThan(0);
    const total = alphaMutants.length + betaMutants.length;
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await restoredFull(dir, report, state, sha);
    const same = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(same.exitCode).toBe(0);
    expect(reusedOf(same.text)).toEqual([total, total]);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "alpha.ts"), "export const alpha = 41 + 1;\n");
    await $`git add alpha.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm alpha`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);
    const changed = await ran($`bunx stryker run --incremental --reporters json --mutate "*.ts"`.cwd(dir).env(ci));
    expect(changed.exitCode).toBe(0);
    expect(reusedOf(changed.text)).toEqual([betaMutants.length, total]);
  },
  480_000,
);

// Ordinary arithmetic is the oracle: 38 is not 42, so strengthening the helper must flip the static mutant from Survived to Killed.


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
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "widget.ts", "helper.ts", "tests/unit/widget.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    expect((probe.files["widget.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Survived")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "helper.ts"), "export const check = (n: number): boolean => n === 42;\n");
    await $`git add helper.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm strengthen`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["widget.ts"]?.mutants ?? [];
    expect(mutants.length).toBeGreaterThan(0);
    for (const mutant of mutants) expect(mutant.status).toBe("Killed");
  },
  480_000,
);

test(
  "a pruned full state reruns a static mutant when an added test asserts what it would kill",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "widget.ts"), "export const widget = 40 + 2;\n");
    await writeFile(join(dir, "helper.ts"), "export const check = (n: number): boolean => n > 0;\n");
    await rm(join(dir, "f.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), PROBE_TEST);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "widget.ts", "helper.ts", "tests/unit/widget.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    expect((probe.files["widget.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Survived")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "tests", "unit", "exact.test.ts"), `import { expect, test } from "bun:test";\nimport { widget } from "../../widget.ts";\n\ntest("exact widget", () => {\n  expect(widget).toBe(42);\n});\n`);
    await $`git add tests/unit/exact.test.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm exact`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate widget.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["widget.ts"]?.mutants ?? [];
    expect(mutants.length).toBeGreaterThan(0);
    for (const mutant of mutants) expect(mutant.status).toBe("Killed");
  },
  480_000,
);

test(
  "a pruned full state reruns a mutant whose test reads the changed file through another source",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "f.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), `import { normalize } from "./b.cjs";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return normalize(v);\n}\n`);
    await writeFile(join(dir, "src", "b.cjs"), `module.exports = require("./c.ts");\n`);
    await writeFile(join(dir, "src", "c.ts"), "export const normalize = (v: number): number => v;\n");
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../src/a.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "src/a.ts", "src/b.cjs", "src/c.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate src/a.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    expect((probe.files["src/a.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Killed")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "src", "c.ts"), "export const normalize = (v: number): number => Math.abs(v);\n");
    await $`git add src/c.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm absolute`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate src/a.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["src/a.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Survived");
  },
  480_000,
);

test(
  "a pruned full state reruns a mutant whose covering test moves its call to module scope",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "f.ts"), "export function f(x: number): number {\n  return x + 2;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBeGreaterThan(-10);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const covered = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(covered.length).toBeGreaterThan(0);
    for (const mutant of covered) {
      expect(mutant.status).toBe("Survived");
      expect(mutant.static).not.toBe(true);
      expect(mutant.coveredBy ?? []).not.toHaveLength(0);
    }

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\nconst result = f(0);\n\ntest("f", () => {\n  expect(result).toBe(2);\n});\n`);
    await $`git add tests/unit/f.test.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm scope`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["f.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Killed");
  },
  480_000,
);

test(
  "a pruned full state reruns an uncovered mutant when an added test imports its module",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "h.ts"), "export function f(x: number): number {\n  return x + 2;\n}\n");
    await rm(join(dir, "f.ts"), { force: true });
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "dummy.test.ts"), `import { expect, test } from "bun:test";\n\ntest("dummy", () => {\n  expect(1).toBe(1);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "h.ts", "tests/unit/dummy.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate h.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const uncovered = (probe.files["h.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(uncovered.length).toBeGreaterThan(0);
    for (const mutant of uncovered) {
      expect(mutant.status).not.toBe("Killed");
      expect(mutant.static).not.toBe(true);
    }

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "tests", "unit", "h.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../h.ts";\n\nconst result = f(0);\n\ntest("h", () => {\n  expect(result).toBe(2);\n});\n`);
    await $`git add tests/unit/h.test.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm cover`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate h.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["h.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Killed");
  },
  480_000,
);

test(
  "a pruned full state reruns a mutant when an added test covers it statically beside an unchanged test",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "f.ts"), "export function f(x: number): number {\n  return x + 2;\n}\n");
    await rm(join(dir, "h.ts"), { force: true });
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBeGreaterThan(-10);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const covered = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(covered.length).toBeGreaterThan(0);
    for (const mutant of covered) {
      expect(mutant.status).toBe("Survived");
      expect(mutant.static).not.toBe(true);
      expect(mutant.coveredBy ?? []).not.toHaveLength(0);
    }

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "tests", "unit", "g.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\nconst result = f(0);\n\ntest("g", () => {\n  expect(result).toBe(2);\n});\n`);
    await $`git add tests/unit/g.test.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm static`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["f.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Killed");
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
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    expect((probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.status === "Killed")).not.toHaveLength(0);

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "f.ts"), "export function f(x: number): number {\n  const v = x + 2;\n  return Math.abs(v);\n}\n");
    await $`git add f.ts && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm absolute`.cwd(dir).quiet();
    await restoredFull(dir, report, state, sha);

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    const rerunReport = await readReport(join(dir, "reports", "mutation", "mutation.json"));
    const mutants = rerunReport.files["f.ts"]?.mutants ?? [];
    const arithmetic = mutants.filter((mutant) => mutant.replacement === "x - 2");
    expect(arithmetic.length).toBeGreaterThan(0);
    for (const mutant of arithmetic) expect(mutant.status).toBe("Survived");
  },
  480_000,
);
