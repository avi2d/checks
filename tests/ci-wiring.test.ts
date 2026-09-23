import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  commands,
  findGaps,
  formatReport,
  parseDeclaration,
  parseWorkflow,
  readDeclaration,
  readWorkflows,
  WiringError,
  type Declaration,
  type Workflow,
} from "../scripts/ci-wiring.ts";

const CI = ".github/workflows/ci.yml";

const RESTORED = `name: ci
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, edited, synchronize, reopened]

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run test
`;

const DECLARATION = parseDeclaration({ ciWiring: { gates: ["bun run lint", "bun run test"] } }, "package.json");

function mutate(workflow: string, from: string, to: string): string {
  if (!workflow.includes(from)) throw new Error(`fixture does not contain ${JSON.stringify(from)}`);
  return workflow.replace(from, to);
}

function gapsIn(files: Readonly<Record<string, string>>, declaration: Declaration = DECLARATION) {
  const workflows: Workflow[] = Object.entries(files).map(([path, text]) => parseWorkflow(path, text));
  return findGaps(declaration, workflows);
}

function lintGap(workflow: string, others: Readonly<Record<string, string>> = {}) {
  const gaps = gapsIn({ [CI]: workflow, ...others });
  expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint"]);
  return gaps[0]!;
}

test("the restored workflow runs every declared gate", () => {
  expect(gapsIn({ [CI]: RESTORED })).toEqual([]);
});

test("a deleted step goes red", () => {
  const gap = lintGap(mutate(RESTORED, "      - run: bun run lint\n", ""));
  expect(gap.blocked).toEqual([]);
});

test("a step replaced with a no-op goes red", () => {
  for (const noop of [
    `      - run: "true"\n`,
    `      - run: echo bun run lint\n`,
    `      - run: |\n          # bun run lint\n          true\n`,
    `      - run: exit 0 # bun run lint\n`,
    `      - name: bun run lint\n        run: ":"\n`,
  ]) {
    expect(lintGap(mutate(RESTORED, "      - run: bun run lint\n", noop)).blocked).toEqual([]);
  }
});

test("a step disabled with if: false goes red", () => {
  for (const condition of ["false", "${{ false }}", "'false'"]) {
    const gap = lintGap(
      mutate(RESTORED, "      - run: bun run lint\n", `      - run: bun run lint\n        if: ${condition}\n`),
    );
    expect(gap.blocked).toEqual([{ location: `${CI} job checks step 4`, blocker: "the step sets if: false" }]);
  }
});

test("a step set to continue-on-error: true goes red", () => {
  for (const flag of ["true", "${{ true }}"]) {
    const gap = lintGap(
      mutate(RESTORED, "      - run: bun run lint\n", `      - run: bun run lint\n        continue-on-error: ${flag}\n`),
    );
    expect(gap.blocked).toEqual([
      { location: `${CI} job checks step 4`, blocker: "the step sets continue-on-error: true" },
    ]);
  }
});

test("a job set to continue-on-error: true or if: false takes every gate in it down", () => {
  for (const [line, blocker] of [
    ["    continue-on-error: true\n", "job checks sets continue-on-error: true"],
    ["    if: false\n", "job checks sets if: false"],
  ] as const) {
    const gaps = gapsIn({ [CI]: mutate(RESTORED, "    runs-on: ubuntu-latest\n", `    runs-on: ubuntu-latest\n${line}`) });
    expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
    expect(gaps[0]!.blocked).toEqual([{ location: `${CI} job checks step 4`, blocker }]);
  }
});

test("a workflow that no longer triggers on pull requests goes red", () => {
  const withoutPullRequest = mutate(RESTORED, "  pull_request:\n    types: [opened, edited, synchronize, reopened]\n", "");
  const gaps = gapsIn({ [CI]: withoutPullRequest });
  expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
  expect(gaps[0]!.blocked).toEqual([
    { location: `${CI} job checks step 4`, blocker: `${CI} does not trigger on pull_request` },
  ]);
});

test("a pull_request trigger that skips the default branch or the pushed commits goes red", () => {
  for (const [filter, blocker] of [
    ["    branches: [release/*]\n", `${CI} limits pull_request to branches other than main`],
    ["    branches: ['**', '!main']\n", `${CI} limits pull_request to branches other than main`],
    ["    branches-ignore: [ma*]\n", `${CI} ignores pull_request to main`],
  ] as const) {
    const workflow = mutate(RESTORED, "    types: [opened, edited, synchronize, reopened]\n", filter);
    expect(gapsIn({ [CI]: workflow })[0]!.blocked[0]!.blocker).toBe(blocker);
  }
  const closedOnly = mutate(RESTORED, "[opened, edited, synchronize, reopened]", "[closed]");
  expect(gapsIn({ [CI]: closedOnly })[0]!.blocked[0]!.blocker).toBe(
    `${CI} limits pull_request to types without opened, synchronize`,
  );
});

test("every shape of the on key that carries pull_request to the default branch passes", () => {
  const jobs = RESTORED.slice(RESTORED.indexOf("jobs:"));
  for (const on of [
    "on: pull_request\n",
    "on: [push, pull_request]\n",
    "on:\n  pull_request:\n",
    "on:\n  pull_request:\n    branches: [main]\n",
    "on:\n  pull_request:\n    branches: ['**']\n    branches-ignore: [release/*]\n",
  ]) {
    expect(gapsIn({ [CI]: `${on}${jobs}` })).toEqual([]);
  }
});

test("the release workflow that also runs the gate does not stand in for pull requests", () => {
  const release = `on:\n  push:\n    tags: ["v*"]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n`;
  const gap = lintGap(mutate(RESTORED, "      - run: bun run lint\n", ""), { ".github/workflows/release.yml": release });
  expect(gap.blocked).toEqual([
    {
      location: ".github/workflows/release.yml job publish step 1",
      blocker: ".github/workflows/release.yml does not trigger on pull_request",
    },
  ]);
});

test("a gate run through a local reusable workflow counts only while the calling job runs", () => {
  const called = `on:\n  workflow_call:\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun .checks/scripts/comment-gate.ts "origin/$BASE_REF" "$HEAD_SHA"\n`;
  const caller = `on: pull_request\njobs:\n  comment-gate:\n    if: github.event_name == 'pull_request'\n    uses: ./.github/workflows/comment-gate.yml\n`;
  const declaration = parseDeclaration(
    { ciWiring: { gates: ["bun .checks/scripts/comment-gate.ts"] } },
    "package.json",
  );
  const files = { [CI]: caller, ".github/workflows/comment-gate.yml": called };
  expect(gapsIn(files, declaration)).toEqual([]);

  const disabled = { ...files, [CI]: mutate(caller, "if: github.event_name == 'pull_request'", "if: false") };
  expect(gapsIn(disabled, declaration)[0]!.blocked).toEqual([
    {
      location: `${CI} job comment-gate > .github/workflows/comment-gate.yml job gate step 1`,
      blocker: "job comment-gate sets if: false",
    },
    {
      location: ".github/workflows/comment-gate.yml job gate step 1",
      blocker: ".github/workflows/comment-gate.yml does not trigger on pull_request",
    },
  ]);
});

test("a workflow that calls itself is walked once", () => {
  const looping = `on: pull_request\njobs:\n  again:\n    uses: ./.github/workflows/ci.yml\n  checks:\n    steps:\n      - run: bun run lint && bun run test\n`;
  expect(gapsIn({ [CI]: looping })).toEqual([]);
});

test("a gate matches the leading words of a command, never a longer word or a later argument", () => {
  const runs = (script: string) =>
    gapsIn({ [CI]: `on: pull_request\njobs:\n  j:\n    steps:\n      - run: ${JSON.stringify(script)}\n` });
  expect(runs("CI=1 bun run lint --quiet 2>&1 && bun run test")).toEqual([]);
  expect(runs("set -e\nbun run lint | tee out\n(cd . && bun run test)")).toEqual([]);
  expect(runs("bun run \\\n  lint; bun run test")).toEqual([]);
  expect(runs("bun run lint:deps && bun run test").map((gap) => gap.gate)).toEqual(["bun run lint"]);
  expect(runs("bun run 'lint' && bun run test")).toEqual([]);
  expect(runs("echo 'bun run lint' && bun run test").map((gap) => gap.gate)).toEqual(["bun run lint"]);
});

test("commands splits a script on control operators and drops comments and leading assignments", () => {
  expect(commands(`FOO="a b" bun run lint # trailing\n# whole line\nprintf '%s' "$T #1" | commitlint --config x`)).toEqual([
    ["bun", "run", "lint"],
    ["printf", "%s", "$T #1"],
    ["commitlint", "--config", "x"],
  ]);
});

test("the report names each gap and why each invocation of it does not count", () => {
  const workflow = mutate(
    mutate(RESTORED, "      - run: bun run lint\n", ""),
    "      - run: bun run test\n",
    "      - run: bun run test\n        if: false\n",
  );
  const report = formatReport(DECLARATION, gapsIn({ [CI]: workflow }));
  expect(report).toBe(
    [
      "ci-wiring: 2 of 2 gate(s) do not run on pull requests to main:",
      "  bun run lint",
      "    no run step invokes it",
      "  bun run test",
      `    ${CI} job checks step 4: the step sets if: false`,
    ].join("\n"),
  );
  expect(formatReport(DECLARATION, [])).toBe("ci-wiring: 2 gate(s) run on pull requests to main");
});

test("the declaration names one command per gate and may move the default branch", () => {
  expect(() => parseDeclaration({}, "package.json")).toThrow(WiringError);
  expect(() => parseDeclaration({ ciWiring: { gates: [] } }, "package.json")).toThrow(WiringError);
  expect(() => parseDeclaration({ ciWiring: { gates: ["a && b"] } }, "package.json")).toThrow(WiringError);
  expect(() => parseDeclaration({ ciWiring: { gates: ["# nothing"] } }, "package.json")).toThrow(WiringError);
  expect(() => parseDeclaration({ ciWiring: { gates: [1] } }, "package.json")).toThrow(WiringError);
  expect(() => parseDeclaration({ ciWiring: { gates: ["x"], defaultBranch: "" } }, "package.json")).toThrow(
    WiringError,
  );

  const trunk = parseDeclaration({ ciWiring: { gates: ["bun run lint"], defaultBranch: "trunk" } }, "package.json");
  const onTrunk = `on:\n  pull_request:\n    branches: [trunk]\njobs:\n  j:\n    steps:\n      - run: bun run lint\n`;
  expect(gapsIn({ [CI]: onTrunk }, trunk)).toEqual([]);
  expect(gapsIn({ [CI]: onTrunk }, parseDeclaration({ ciWiring: { gates: ["bun run lint"] } }, "p"))).toHaveLength(1);
});

test("a workflow that is not YAML is refused", () => {
  expect(() => parseWorkflow(CI, "jobs: [")).toThrow(WiringError);
});

test("this repository's own CI runs its declared gates, and loses lint without the lint step", () => {
  const root = resolve(import.meta.dir, "..");
  const declaration = readDeclaration(root);
  const workflows = readWorkflows(root);
  expect(findGaps(declaration, workflows)).toEqual([]);

  const ci = readFileSync(resolve(root, CI), "utf8");
  const withoutLint = workflows.map((workflow) =>
    workflow.path === CI ? parseWorkflow(CI, mutate(ci, "      - run: bun run lint\n", "")) : workflow,
  );
  expect(findGaps(declaration, withoutLint).map((gap) => gap.gate)).toEqual(["bun run lint"]);
});
