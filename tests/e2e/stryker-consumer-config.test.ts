import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ran, UNVENDORED_BUNFIG } from "./lib/fixture-repo.ts";
import { committedBase, dropModuleType, readReport, readState, removeConsumer, restoredFull, unpackConsumer } from "./lib/stryker-consumer.ts";

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
  "a pruned full state drops every result when a differently named Stryker config changes",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await writeFile(join(dir, "stryker.conf.js"), `import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";\n\nprocess.env.ABS = "false";\n\nexport default {\n  ...preset,\n  bun: {\n    ...preset.bun,\n    testFiles: unitTestFiles(),\n  },\n};\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.js", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "stryker.conf.js"), `import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";\n\nprocess.env.ABS = "true";\n\nexport default {\n  ...preset,\n  bun: {\n    ...preset.bun,\n    testFiles: unitTestFiles(),\n  },\n};\n`);
    await $`git add stryker.conf.js && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when a module the Stryker config loads changes",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), `import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";\nimport { ABS } from "./settings.js";\n\nprocess.env.ABS = ABS;\n\nexport default {\n  ...preset,\n  bun: {\n    ...preset.bun,\n    testFiles: unitTestFiles(),\n  },\n};\n`);
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "settings.js"), `export const ABS = "false";\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "settings.js", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "settings.js"), `export const ABS = "true";\n`);
    await $`git add settings.js && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when a JSON module the Stryker config requires changes",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./settings");\n\nprocess.env.ABS = ABS;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings.js"), { force: true });
    await writeFile(join(dir, "settings.json"), `{ "ABS": "false" }\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "settings.json", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "settings.json"), `{ "ABS": "true" }\n`);
    await $`git add settings.json && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when a package main the Stryker config requires changes",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./settings");\n\nprocess.env.ABS = ABS;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await rm(join(dir, "dual.js"), { force: true });
    await rm(join(dir, "dual.ts"), { force: true });
    await mkdir(join(dir, "settings"), { recursive: true });
    await writeFile(join(dir, "settings", "package.json"), `{ "main": "mode.cjs" }\n`);
    await writeFile(join(dir, "settings", "mode.cjs"), `module.exports = { ABS: "false" };\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "settings/package.json", "settings/mode.cjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "settings", "mode.cjs"), `module.exports = { ABS: "true" };\n`);
    await $`git add settings/mode.cjs && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when the .js twin of a required .ts file changes",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./dual");\n\nprocess.env.ABS = ABS;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings"), { recursive: true, force: true });
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await writeFile(join(dir, "dual.js"), `module.exports = { ABS: "false" };\n`);
    await writeFile(join(dir, "dual.ts"), `export const ABS = "false";\n`);
    await dropModuleType(dir);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "dual.js", "dual.ts", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "dual.js"), `module.exports = { ABS: "true" };\n`);
    await $`git add dual.js && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when the manifest switches the required entry",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./settings");\n\nprocess.env.ABS = ABS;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await rm(join(dir, "dual.js"), { force: true });
    await rm(join(dir, "dual.ts"), { force: true });
    await rm(join(dir, "settings"), { recursive: true, force: true });
    await mkdir(join(dir, "settings"), { recursive: true });
    await writeFile(join(dir, "settings", "package.json"), `{ "main": "false.cjs" }\n`);
    await writeFile(join(dir, "settings", "false.cjs"), `module.exports = { ABS: "false" };\n`);
    await writeFile(join(dir, "settings", "true.cjs"), `module.exports = { ABS: "true" };\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "settings/package.json", "settings/false.cjs", "settings/true.cjs", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "settings", "package.json"), `{ "main": "true.cjs" }\n`);
    await $`git add settings/package.json && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when the manifest drops its main",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./settings");\n\nprocess.env.ABS = ABS;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await rm(join(dir, "dual.js"), { force: true });
    await rm(join(dir, "dual.ts"), { force: true });
    await rm(join(dir, "settings"), { recursive: true, force: true });
    await mkdir(join(dir, "settings"), { recursive: true });
    await writeFile(join(dir, "settings", "package.json"), `{ "main": "false.cjs" }\n`);
    await writeFile(join(dir, "settings", "false.cjs"), `module.exports = { ABS: "false" };\n`);
    await writeFile(join(dir, "settings", "index.js"), `module.exports = { ABS: "true" };\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "settings/package.json", "settings/false.cjs", "settings/index.js", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await writeFile(join(dir, "settings", "package.json"), `{}\n`);
    await $`git add settings/package.json && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
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

test(
  "a pruned full state drops every result when the manifest is removed",
  async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await rm(join(dir, "stryker.conf.mjs"), { force: true });
    await rm(join(dir, "stryker.conf.js"), { force: true });
    await writeFile(join(dir, "stryker.conf.cjs"), `const { ABS } = require("./settings");\nconst { TAG } = require("./settings/extra");\n\nprocess.env.ABS = ABS;\nprocess.env.TAG = TAG;\n\nmodule.exports = {\n  packageManager: "npm",\n  plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],\n  testRunner: "bun",\n  coverageAnalysis: "perTest",\n  timeoutMS: 60000,\n  thresholds: { high: 85, low: 70, break: null },\n};\n`);
    await rm(join(dir, "settings.js"), { force: true });
    await rm(join(dir, "settings.json"), { force: true });
    await rm(join(dir, "dual.js"), { force: true });
    await rm(join(dir, "dual.ts"), { force: true });
    await rm(join(dir, "settings"), { recursive: true, force: true });
    await mkdir(join(dir, "settings"), { recursive: true });
    await dropModuleType(dir);
    await writeFile(join(dir, "settings", "package.json"), `{ "main": "false.cjs" }\n`);
    await writeFile(join(dir, "settings", "false.cjs"), `module.exports = { ABS: "false" };\n`);
    await writeFile(join(dir, "settings", "index.js"), `module.exports = { ABS: "true" };\n`);
    await writeFile(join(dir, "settings", "extra.js"), `module.exports = { TAG: "js" };\n`);
    await writeFile(join(dir, "settings", "extra.json"), `{ "TAG": "json" }\n`);
    await writeFile(join(dir, "f.ts"), "const absolute = process.env.ABS === \"true\";\n\nexport function f(x: number): number {\n  const v = x + 2;\n  return absolute ? Math.abs(v) : v;\n}\n");
    await rm(join(dir, "widget.ts"), { force: true });
    await rm(join(dir, "helper.ts"), { force: true });
    await rm(join(dir, "src"), { recursive: true, force: true });
    await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "f.test.ts"), `import { expect, test } from "bun:test";\nimport { f } from "../../f.ts";\n\ntest("f", () => {\n  expect(f(0)).toBe(2);\n});\n`);
    await rm(join(dir, "reports"), { recursive: true, force: true });
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.cjs", "settings/package.json", "settings/false.cjs", "settings/index.js", "settings/extra.js", "settings/extra.json", "package.json", "f.ts", "tests/unit/f.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate f.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const probe = readState(state);
    const killed = (probe.files["f.ts"]?.mutants ?? []).filter((mutant) => mutant.replacement === "x - 2");
    expect(killed.length).toBeGreaterThan(0);
    for (const mutant of killed) expect(mutant.status).toBe("Killed");

    await rm(join(dir, "reports"), { recursive: true, force: true });
    await rm(join(dir, "settings", "package.json"));
    await rm(join(dir, "settings", "extra.js"));
    await $`git rm -q settings/package.json settings/extra.js && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm flip`.cwd(dir).quiet();
    const dropped = await restoredFull(dir, report, state, sha);
    expect(dropped).toContain("settings/extra.js");

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