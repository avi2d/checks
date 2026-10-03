import { expect, test } from "bun:test";
import { Effect } from "effect";
import { declarationFor, findGaps, findRunnerFaults, formatReport, formatRunnerReport, parseWorkflow, requiredCommands } from "../../src/delivery/ci-wiring.ts";

const scripts = ["lint", "build", "typecheck", "test"];
const declaration = declarationFor(scripts, "main");

function workflow(text: string) {
  return [Effect.runSync(parseWorkflow(".github/workflows/ci.yml", text))];
}

const prefix = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n`;
const steps = ["bun run lint", "bun run build", "git diff --exit-code", "bun run typecheck", "bun run test", "./node_modules/.bin/commitlint"];
const full = `${prefix}${steps.map((command) => `      - run: ${command}\n`).join("")}`;

test("the kit requires title lint always and each command package.json can run", () => {
  expect(requiredCommands([])).toEqual(["./node_modules/.bin/commitlint"]);
  expect(requiredCommands(["lint", "test", "start"])).toEqual(["bun run lint", "bun run test", "./node_modules/.bin/commitlint"]);
  expect(requiredCommands(["build"])).toEqual(["bun run build", "git diff --exit-code", "./node_modules/.bin/commitlint"]);
  expect(requiredCommands(scripts)).toEqual(steps);
});

test("the workflow runs every kit gate on opened and synchronized pull requests", () => {
  expect(findGaps(declaration, workflow(full))).toEqual([]);
  expect(formatReport(declaration, [])).toBe("ci-wiring: 6 gate(s) run on pull requests to main");
});

test("a missing mandatory command fails rather than reducing the required list", () => {
  const missing = findGaps(declaration, workflow(full.replace("      - run: bun run build\n", "")));
  expect(missing.map(({ gate }) => gate)).toEqual(["bun run build"]);
  expect(findGaps(declaration, workflow(full))).toEqual([]);
});

test("a disabled command cannot satisfy the gate", () => {
  const red = full.replace("      - run: bun run test", "      - run: bun run test\n        if: false");
  expect(findGaps(declaration, workflow(red))[0]?.blocked[0]?.blocker).toContain("if: false");
  const continued = full.replace("      - run: bun run test", "      - run: bun run test\n        continue-on-error: true");
  expect(findGaps(declaration, workflow(continued))[0]?.blocked[0]?.blocker).toContain("continue-on-error: true");
});

test("a workflow without both required pull request events does not count", () => {
  const red = full.replace("[opened, synchronize]", "[opened]");
  expect(findGaps(declaration, workflow(red)).length).toBe(steps.length);
});

test("a branch filter that excludes the target does not count", () => {
  const red = full.replace("    types: [opened, synchronize]", "    types: [opened, synchronize]\n    branches: [release]");
  expect(findGaps(declaration, workflow(red)).length).toBe(steps.length);
});

test("a pull_request branch filter gates pull requests to the default branch it names", () => {
  const master = workflow(full.replace("    types: [opened, synchronize]\n", "    branches: [master]\n"));
  expect(findGaps(declarationFor(scripts, "master"), master)).toEqual([]);
  expect(findGaps(declaration, master).length).toBe(steps.length);
});

test("a pull_request trigger with no branch filter gates every default branch", () => {
  for (const on of ["on:\n  pull_request:\n", "on: pull_request\n", "on: [push, pull_request]\n"]) {
    const unfiltered = workflow(full.replace("on:\n  pull_request:\n    types: [opened, synchronize]\n", on));
    expect(findGaps(declarationFor(scripts, "master"), unfiltered)).toEqual([]);
  }
});

test("a second active workflow can satisfy a missing title gate", () => {
  const ci = workflow(full.replace("      - run: ./node_modules/.bin/commitlint\n", ""));
  const title = Effect.runSync(parseWorkflow(".github/workflows/title.yml", `${prefix}      - run: ./node_modules/.bin/commitlint\n`));
  expect(findGaps(declaration, [...ci, title])).toEqual([]);
});

const WINBOX = "[self-hosted, Linux, X64, winbox]";
const HOSTED = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
const OLD_DEFAULT = `\${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","Linux","X64","winbox"]') }}`;
const noScripts = new Map<string, string>();

function jobs(mutationRunsOn: string, checksRunsOn: string) {
  return workflow(
    `on: pull_request\njobs:\n  mutation:\n    runs-on: ${mutationRunsOn}\n    steps:\n      - run: bunx stryker run\n  checks:\n    runs-on: ${checksRunsOn}\n    steps:\n      - run: bun run lint\n`,
  );
}

test("a private repository pins mutation jobs to winbox and defaults every other job to a hosted runner", () => {
  expect(findRunnerFaults({ visibility: "private", scripts: noScripts }, jobs(WINBOX, HOSTED))).toEqual([]);
  const old = findRunnerFaults({ visibility: "private", scripts: noScripts }, jobs(OLD_DEFAULT, OLD_DEFAULT));
  expect(old.map(({ location }) => location)).toEqual([".github/workflows/ci.yml job mutation", ".github/workflows/ci.yml job checks"]);
  expect(old[0]?.fault).toContain("reads CI_RUNS_ON");
  expect(old[1]?.fault).toContain(HOSTED);
  const plain = findRunnerFaults({ visibility: "private", scripts: noScripts }, jobs("ubuntu-latest", "ubuntu-latest"));
  expect(plain.map(({ fault }) => fault)).toEqual([expect.stringContaining(WINBOX), expect.stringContaining(HOSTED)]);
});

test("any repository refuses a mutation job that reads CI_RUNS_ON and an override without the hosted default", () => {
  for (const visibility of ["public", "unknown"] as const) {
    expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs("ubuntu-latest", "ubuntu-latest"))).toEqual([]);
    expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(WINBOX, HOSTED))).toEqual([]);
    expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(HOSTED, OLD_DEFAULT)).length).toBe(2);
  }
});

test("a package script, a kit bin or a prefixed stryker run marks the job as a mutation job", () => {
  const mutating = new Map([["mutate", "bunx stryker run --incremental"], ["loop", "bun run loop"]]);
  for (const step of ["bun run mutate", "time bunx stryker run --mutate src", "./node_modules/.bin/checks-mutation-compare a b", "bun run checks-mutation"]) {
    const faults = findRunnerFaults(
      { visibility: "private", scripts: mutating },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${step}\n`),
    );
    expect(faults[0]?.fault).toContain(WINBOX);
  }
  const looping = workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: bun run loop\n`);
  expect(findRunnerFaults({ visibility: "private", scripts: mutating }, looping)).toEqual([]);
});

test("quoted words and line continuations still mark a mutation job, and a shell comment does not", () => {
  const mutating = new Map([["mutate", "bunx 'stryker' \\\n  run"]]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: mutating },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ['bun run "mutate"', "bun run mutate", '"./node_modules/.bin/checks-mutation"', "bunx stryker \\\n  run", "echo start\nbunx stryker run"]) {
    expect(sweep(run)[0]?.fault).toContain(WINBOX);
  }
  for (const run of ["bun run lint\n# bunx stryker run", "bun run lint # bunx stryker run", "echo 'bunx stryker run'"]) {
    expect(sweep(run)).toEqual([]);
  }
});

test("the runner report names each job and what to set", () => {
  const faults = findRunnerFaults({ visibility: "private", scripts: noScripts }, jobs("ubuntu-latest", HOSTED));
  expect(formatRunnerReport(faults)).toBe(
    `ci-wiring: 1 job(s) run on the wrong runner:\n  .github/workflows/ci.yml job mutation: ${faults[0]?.fault}`,
  );
});
