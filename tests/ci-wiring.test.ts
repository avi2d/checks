import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
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

function declared(manifest: unknown, source: string): Declaration {
  return Effect.runSync(parseDeclaration(manifest, source));
}

function parsed(path: string, text: string): Workflow {
  return Effect.runSync(parseWorkflow(path, text));
}

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

const DECLARATION = declared({ ciWiring: { gates: ["bun run lint", "bun run test"] } }, "package.json");

function mutate(workflow: string, from: string, to: string): string {
  if (!workflow.includes(from)) throw new Error(`fixture does not contain ${JSON.stringify(from)}`);
  return workflow.replace(from, to);
}

function gapsIn(files: Readonly<Record<string, string>>, declaration: Declaration = DECLARATION) {
  const workflows: Workflow[] = Object.entries(files).map(([path, text]) => parsed(path, text));
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
    lintGap(mutate(RESTORED, "      - run: bun run lint\n", noop));
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

test("a pull_request trigger filtered by paths goes red, since some pull requests skip the gate", () => {
  for (const filter of ["    paths: ['src/**']\n", "    paths-ignore: ['**.md']\n"]) {
    const workflow = mutate(RESTORED, "    types: [opened, edited, synchronize, reopened]\n", `    types: [opened, synchronize]\n${filter}`);
    const gaps = gapsIn({ [CI]: workflow });
    expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
    expect(gaps[0]!.blocked).toEqual([
      {
        location: `${CI} job checks step 4`,
        blocker: `${CI} filters pull_request by paths, so some pull requests skip the gate`,
      },
    ]);
  }
});

test("a job that needs a job set to if: false, directly or through a chain, goes red unless an if: calling a status function overrides the skip", () => {
  const withNeeds = (checks: string, extra = "") =>
    `on: pull_request\njobs:\n  setup:\n    if: false\n    steps:\n      - run: "true"\n${extra}  checks:\n${checks}    steps:\n      - run: bun run lint\n      - run: bun run test\n`;
  const direct = gapsIn({ [CI]: withNeeds("    needs: setup\n") });
  expect(direct.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
  expect(direct[0]!.blocked).toEqual([
    { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
  ]);

  const chained = gapsIn({ [CI]: withNeeds("    needs: [build]\n", "  build:\n    needs: setup\n") });
  expect(chained[0]!.blocked).toEqual([
    { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
  ]);

  for (const condition of ["github.event_name == 'pull_request'", "true", "${{ true }}", "success()"]) {
    expect(gapsIn({ [CI]: withNeeds(`    needs: setup\n    if: ${condition}\n`) })[0]!.blocked).toEqual([
      { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
    ]);
  }
  expect(
    gapsIn({ [CI]: withNeeds("    needs: [build]\n", "  build:\n    needs: setup\n    if: true\n") })[0]!.blocked,
  ).toEqual([
    { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
  ]);

  for (const condition of ["always()", "${{ !cancelled() }}", "failure()"]) {
    expect(gapsIn({ [CI]: withNeeds(`    needs: setup\n    if: ${condition}\n`) })).toEqual([]);
  }
  expect(gapsIn({ [CI]: withNeeds("    needs: [build]\n", "  build:\n    needs: setup\n    if: always()\n") })).toEqual(
    [],
  );
  expect(gapsIn({ [CI]: mutate(withNeeds("    needs: setup\n"), "    if: false\n", "") })).toEqual([]);
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
  const declaration = declared(
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
  const looping = `on: pull_request\njobs:\n  again:\n    uses: ./.github/workflows/ci.yml\n  checks:\n    steps:\n      - run: bun run lint\n      - run: bun run test\n`;
  expect(gapsIn({ [CI]: looping })).toEqual([]);
});

function stepGaps(script: string, gate = "bun run lint") {
  const declaration = declared({ ciWiring: { gates: [gate] } }, "package.json");
  const workflow = `on: pull_request\njobs:\n  j:\n    steps:\n      - run: ${JSON.stringify(script)}\n`;
  return gapsIn({ [CI]: workflow }, declaration);
}

test("a gate step counts only as the gate alone on one line with plain arguments", () => {
  for (const plain of [
    "bun run lint",
    "bun run lint\n",
    "bun run lint --quiet",
    "bun run 'lint'",
    `bun run lint "$TARGET" \${MODE} '$(not run)' ""`,
  ]) {
    expect(stepGaps(plain)).toEqual([]);
  }
  expect(stepGaps(`bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`, "bunx checks-comment-gate")).toEqual([]);
  expect(stepGaps("bun run lint:deps")).toEqual([{ gate: "bun run lint", blocked: [] }]);
});

test("a step running checks-lint covers each kit gate it runs by bare bin name, called the way the gate is declared", () => {
  const kit = declared(
    {
      ciWiring: {
        gates: [
          `bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`,
          "bunx checks-suppressions-ratchet",
          "bun .checks/scripts/commit-identity.ts",
          "bunx checks-mutation-compare",
        ],
      },
    },
    "package.json",
  );
  const workflow = (steps: readonly string[]) =>
    `on: pull_request\njobs:\n  j:\n    steps:\n${steps.map((step) => `      - run: ${JSON.stringify(step)}\n`).join("")}`;

  const covered = gapsIn({ [CI]: workflow(["bunx checks-lint", "bun .checks/scripts/lint.ts"]) }, kit);
  expect(covered.map((gap) => gap.gate)).toEqual(["bun .checks/scripts/commit-identity.ts", "bunx checks-mutation-compare"]);

  const uncovered = gapsIn({ [CI]: workflow(["bunx checks-lint-coverage", "bun run checks-lint"]) }, kit);
  expect(formatReport(kit, uncovered)).toBe(
    [
      "ci-wiring: 4 of 4 gate(s) do not run on pull requests to main:",
      `  bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`,
      "    no run step invokes it or bunx checks-lint",
      "  bunx checks-suppressions-ratchet",
      "    no run step invokes it or bunx checks-lint",
      "  bun .checks/scripts/commit-identity.ts",
      "    no run step invokes it",
      "  bunx checks-mutation-compare",
      "    no run step invokes it",
    ].join("\n"),
  );

  expect(stepGaps("bunx checks-lint || true", "bunx checks-comment-gate")).toEqual([
    {
      gate: "bunx checks-comment-gate",
      entryPoint: "bunx checks-lint",
      blocked: [
        {
          location: `${CI} job j step 1`,
          blocker: "the step runs more than bunx checks-lint; give it its own step with nothing else in it",
        },
      ],
    },
  ]);
});

test("a gate step with any shell control, substitution, redirection or second line goes red and says why", () => {
  for (const shaped of [
    "bun run lint | tee lint.log",
    "bun run lint || true",
    "bun run lint || exit 1",
    "bun run lint && echo passed",
    "bun run lint; true",
    "bun run lint &",
    "bun run lint $(echo --quiet)",
    "echo $(bun run lint)",
    `bun run lint "$(echo --quiet)"`,
    "bun run lint `echo --quiet`",
    "bun run lint < /dev/null",
    "bun run lint > lint.log",
    "bun run lint 2>&1",
    "set -e\nbun run lint",
    "bun run lint\necho done",
    "exit 0\nbun run lint",
    "CI=1 bun run lint",
    "bun run lint # quiet",
  ]) {
    expect(stepGaps(shaped)).toEqual([
      {
        gate: "bun run lint",
        blocked: [
          {
            location: `${CI} job j step 1`,
            blocker: "the step runs more than bun run lint; give it its own step with nothing else in it",
          },
        ],
      },
    ]);
  }
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

test("a step running checks-lint covers no gate its declared selection leaves out", () => {
  const gates = ["bunx checks-test-layout", "bunx checks-comment-gate"];
  const selecting = (lintGates: Readonly<Record<string, unknown>> = {}) =>
    declared({ ciWiring: { gates, ...lintGates } }, "package.json");
  const workflow = `on: pull_request\njobs:\n  j:\n    steps:\n      - run: bunx checks-lint\n`;

  expect(gapsIn({ [CI]: workflow }, selecting())).toEqual([]);
  const metadataOnly = selecting({ lintGates: ["checks-commit-identity", "checks-comment-gate", "checks-ci-wiring"] });
  expect(gapsIn({ [CI]: workflow }, metadataOnly)).toEqual([{ gate: "bunx checks-test-layout", blocked: [] }]);
});

test("a selection names each kit gate once and keeps every gate that applies to every repository", () => {
  const refusal = (lintGates: unknown) =>
    Effect.runSync(Effect.flip(parseDeclaration({ ciWiring: { gates: ["x"], lintGates } }, "package.json"))).message;

  expect(refusal(["checks-ci-wiring", "checks-comment-gate"])).toContain(
    "package.json: checks-lint must run checks-commit-identity, which applies to every repository",
  );
  expect(refusal(["checks-lint-coverage"])).toContain(
    "checks-lint must run checks-commit-identity, checks-comment-gate, checks-ci-wiring, which apply to every repository",
  );
  expect(refusal(["checks-commit-identity", "checks-comment-gate", "checks-ci-wiring", "checks-ci-wiring"])).toContain(
    "Expected an array with unique items",
  );
  expect(refusal(["checks-commit-identity", "checks-comment-gate", "checks-ci-wiring", "checks-backtest"])).toContain(
    'Expected "checks-lint-coverage" |',
  );
  expect(refusal("checks-ci-wiring")).toContain("Expected array");

  const selected = declared(
    { ciWiring: { gates: ["x"], lintGates: ["checks-ci-wiring", "checks-comment-gate", "checks-commit-identity"] } },
    "package.json",
  );
  expect(selected.lintGates.map((gate) => gate.bin)).toEqual([
    "checks-commit-identity",
    "checks-comment-gate",
    "checks-ci-wiring",
  ]);
});

test("the declaration names one command per gate and may move the default branch", () => {
  expect(() => declared({}, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: [] } }, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: ["a && b"] } }, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: ["bun run lint || true"] } }, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: ["# nothing"] } }, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: [1] } }, "package.json")).toThrow(WiringError);
  expect(() => declared({ ciWiring: { gates: ["x"], defaultBranch: "" } }, "package.json")).toThrow(
    WiringError,
  );

  const trunk = declared({ ciWiring: { gates: ["bun run lint"], defaultBranch: "trunk" } }, "package.json");
  const onTrunk = `on:\n  pull_request:\n    branches: [trunk]\njobs:\n  j:\n    steps:\n      - run: bun run lint\n`;
  expect(gapsIn({ [CI]: onTrunk }, trunk)).toEqual([]);
  expect(gapsIn({ [CI]: onTrunk }, declared({ ciWiring: { gates: ["bun run lint"] } }, "p"))).toHaveLength(1);
});

test("a workflow that is not YAML is refused", () => {
  expect(() => parsed(CI, "jobs: [")).toThrow(WiringError);
});

test("this repository's own CI runs its declared gates, and loses lint without the lint step", async () => {
  const root = resolve(import.meta.dir, "..");
  const [declaration, workflows] = await Effect.runPromise(
    Effect.all([readDeclaration(root), readWorkflows(root)]).pipe(Effect.provide(BunServices.layer)),
  );
  expect(findGaps(declaration, workflows)).toEqual([]);

  const ci = readFileSync(resolve(root, CI), "utf8");
  const withoutLint = workflows.map((workflow) =>
    workflow.path === CI ? parsed(CI, mutate(ci, "      - run: bun run lint\n", "")) : workflow,
  );
  expect(findGaps(declaration, withoutLint).map((gap) => gap.gate)).toEqual(["bun run lint"]);
});
