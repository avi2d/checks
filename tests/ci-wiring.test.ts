import { BunServices } from "@effect/platform-bun";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findGaps,
  findScheduledGaps,
  formatReport,
  formatScheduledReport,
  parseDeclaration,
  parseWorkflow,
  readDeclaration,
  readWorkflows,
  WiringError,
  type Declaration,
  type Workflow,
} from "../scripts/ci-wiring.ts";
import { decodeQuality, QualityUnreadable } from "../scripts/quality-file.ts";

function declared(quality: unknown, source = "quality.json"): Declaration {
  return Effect.runSync(
    decodeQuality(JSON.stringify(quality), source).pipe(Effect.flatMap((decoded) => parseDeclaration(decoded, source))),
  );
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

const DECLARATION = declared({ gates: { ci: ["bun run lint", "bun run test"] } });

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
  const [gap] = gaps;
  if (gap === undefined) throw new Error("expected a gap for bun run lint");
  return gap;
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
    expect(gaps[0]?.blocked).toEqual([{ location: `${CI} job checks step 4`, blocker }]);
  }
});

test("a workflow that no longer triggers on pull requests goes red", () => {
  const withoutPullRequest = mutate(RESTORED, "  pull_request:\n    types: [opened, edited, synchronize, reopened]\n", "");
  const gaps = gapsIn({ [CI]: withoutPullRequest });
  expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
  expect(gaps[0]?.blocked).toEqual([
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
    expect(gapsIn({ [CI]: workflow })[0]?.blocked[0]?.blocker).toBe(blocker);
  }
  const closedOnly = mutate(RESTORED, "[opened, edited, synchronize, reopened]", "[closed]");
  expect(gapsIn({ [CI]: closedOnly })[0]?.blocked[0]?.blocker).toBe(
    `${CI} limits pull_request to types without opened, synchronize`,
  );
});

test("a pull_request trigger filtered by paths goes red, since some pull requests skip the gate", () => {
  for (const filter of ["    paths: ['src/**']\n", "    paths-ignore: ['**.md']\n"]) {
    const workflow = mutate(RESTORED, "    types: [opened, edited, synchronize, reopened]\n", `    types: [opened, synchronize]\n${filter}`);
    const gaps = gapsIn({ [CI]: workflow });
    expect(gaps.map((gap) => gap.gate)).toEqual(["bun run lint", "bun run test"]);
    expect(gaps[0]?.blocked).toEqual([
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
  expect(direct[0]?.blocked).toEqual([
    { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
  ]);

  const chained = gapsIn({ [CI]: withNeeds("    needs: [build]\n", "  build:\n    needs: setup\n") });
  expect(chained[0]?.blocked).toEqual([
    { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
  ]);

  for (const condition of ["github.event_name == 'pull_request'", "true", "${{ true }}", "success()"]) {
    expect(gapsIn({ [CI]: withNeeds(`    needs: setup\n    if: ${condition}\n`) })[0]?.blocked).toEqual([
      { location: `${CI} job checks step 1`, blocker: "job checks needs a job that never runs: job setup sets if: false" },
    ]);
  }
  expect(
    gapsIn({ [CI]: withNeeds("    needs: [build]\n", "  build:\n    needs: setup\n    if: true\n") })[0]?.blocked,
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
  const declaration = declared({ gates: { ci: ["bun .checks/scripts/comment-gate.ts"] } });
  const files = { [CI]: caller, ".github/workflows/comment-gate.yml": called };
  expect(gapsIn(files, declaration)).toEqual([]);

  const disabled = { ...files, [CI]: mutate(caller, "if: github.event_name == 'pull_request'", "if: false") };
  expect(gapsIn(disabled, declaration)[0]?.blocked).toEqual([
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
  const declaration = declared({ gates: { ci: [gate] } });
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
  const kit = declared({
    gates: {
      ci: [
        `bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`,
        "bunx checks-suppressions-ratchet",
        "bun .checks/scripts/commit-identity.ts",
        "bunx checks-mutation-compare",
      ],
    },
  });
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
  const selecting = (lint: Readonly<Record<string, unknown>> = {}) => declared({ gates: { ci: gates, ...lint } });
  const workflow = `on: pull_request\njobs:\n  j:\n    steps:\n      - run: bunx checks-lint\n`;

  expect(gapsIn({ [CI]: workflow }, selecting())).toEqual([]);
  const metadataOnly = selecting({
    lint: ["checks-commit-identity", "checks-comment-gate", "checks-suppressions-ratchet", "checks-ci-wiring", "checks-docs"],
  });
  expect(gapsIn({ [CI]: workflow }, metadataOnly)).toEqual([{ gate: "bunx checks-test-layout", blocked: [] }]);
});

test("a selection names kit gates and keeps every gate that applies to every repository", () => {
  const refusal = (lintGates: unknown) =>
    Effect.runSync(Effect.flip(decodeQuality(JSON.stringify({ gates: { ci: ["x"], lint: lintGates } }), "quality.json")))
      .message;

  const metadata = [
    "checks-commit-identity",
    "checks-comment-gate",
    "checks-suppressions-ratchet",
    "checks-ci-wiring",
    "checks-docs",
  ];

  expect(refusal(["checks-ci-wiring", "checks-comment-gate", "checks-suppressions-ratchet", "checks-docs"])).toContain(
    "quality.json: checks-lint must run checks-commit-identity, which applies to every repository",
  );
  expect(refusal(["checks-commit-identity", "checks-comment-gate", "checks-ci-wiring", "checks-docs"])).toContain(
    "quality.json: checks-lint must run checks-suppressions-ratchet, which applies to every repository",
  );
  expect(refusal(["checks-lint-coverage"])).toContain(
    "checks-lint must run checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet, checks-ci-wiring, checks-docs, which apply to every repository",
  );
  expect(refusal([...metadata, "checks-backtest"])).toContain('Expected "checks-lint-coverage" |');
  expect(refusal("checks-ci-wiring")).toContain("Expected array");

  const selected = declared({ gates: { ci: ["x"], lint: metadata.toReversed() } });
  expect(selected.lintGates.map((gate) => gate.bin)).toEqual(metadata);
});

test("the declaration names one command per gate and may move the default branch", () => {
  expect(() => declared({})).toThrow("quality.json declares no gates.ci, a non-empty array of commands");
  expect(() => declared({}, "package.json")).toThrow("quality.json declares no gates.ci, a non-empty array of commands");
  expect(() => declared({ gates: { ci: ["a && b"] } })).toThrow(WiringError);
  expect(() => declared({ gates: { ci: ["bun run lint || true"] } })).toThrow(WiringError);
  expect(() => declared({ gates: { ci: ["# nothing"] } })).toThrow(WiringError);
  expect(() => declared({ gates: { ci: [] } })).toThrow(QualityUnreadable);
  expect(() => declared({ gates: { ci: [1] } })).toThrow(QualityUnreadable);
  expect(() => declared({ gates: { ci: ["x"] }, defaultBranch: "" })).toThrow(QualityUnreadable);

  const trunk = declared({ gates: { ci: ["bun run lint"] }, defaultBranch: "trunk" });
  const onTrunk = `on:\n  pull_request:\n    branches: [trunk]\njobs:\n  j:\n    steps:\n      - run: bun run lint\n`;
  expect(gapsIn({ [CI]: onTrunk }, trunk)).toEqual([]);
  expect(gapsIn({ [CI]: onTrunk }, declared({ gates: { ci: ["bun run lint"] } }))).toHaveLength(1);
});

const FLAKE = ".github/workflows/flake.yml";

const SCHEDULED = `name: flake
on:
  schedule:
    - cron: "0 5 * * *"
  workflow_dispatch:

jobs:
  flake:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx checks-flake --report flake-report.json
`;

const FLAKE_DECLARATION = declared(
  { gates: { ci: ["bun run lint"], scheduled: ["bunx checks-flake --report flake-report.json"] } },
);

function scheduledGapsIn(files: Readonly<Record<string, string>>) {
  const workflows: Workflow[] = Object.entries(files).map(([path, text]) => parsed(path, text));
  return findScheduledGaps(FLAKE_DECLARATION, workflows);
}

test("a scheduled command counts only in a workflow a cron schedule triggers", () => {
  expect(scheduledGapsIn({ [CI]: RESTORED, [FLAKE]: SCHEDULED })).toEqual([]);

  const onPullRequests = mutate(RESTORED, "      - run: bun run test\n", "      - run: bunx checks-flake --report flake-report.json\n");
  expect(scheduledGapsIn({ [CI]: onPullRequests })).toEqual([
    {
      gate: "bunx checks-flake --report flake-report.json",
      entryPoint: undefined,
      blocked: [{ location: `${CI} job checks step 5`, blocker: `${CI} does not trigger on a schedule` }],
    },
  ]);

  const noCron = mutate(SCHEDULED, '  schedule:\n    - cron: "0 5 * * *"\n', "  schedule: []\n");
  expect(scheduledGapsIn({ [FLAKE]: noCron })[0]?.blocked[0]?.blocker).toBe(`${FLAKE} does not trigger on a schedule`);
});

test("a scheduled command is switched off and hidden behind shell control the same ways a gate is", () => {
  const command = "      - run: bunx checks-flake --report flake-report.json\n";
  const blockers = [
    [`${command}        if: false\n`, "the step sets if: false"],
    [`${command}        continue-on-error: true\n`, "the step sets continue-on-error: true"],
    [
      "      - run: bunx checks-flake --report flake-report.json >> $GITHUB_STEP_SUMMARY\n",
      "the step runs more than bunx checks-flake --report flake-report.json; give it its own step with nothing else in it",
    ],
  ] as const;
  for (const [step, blocker] of blockers) {
    const [gap, ...others] = scheduledGapsIn({ [FLAKE]: mutate(SCHEDULED, command, step) });
    expect(others).toEqual([]);
    expect(gap?.blocked).toEqual([{ location: `${FLAKE} job flake step 4`, blocker }]);
  }
  const skippedJob = mutate(SCHEDULED, "  flake:\n    runs-on: ubuntu-latest\n", "  flake:\n    if: false\n    runs-on: ubuntu-latest\n");
  expect(scheduledGapsIn({ [FLAKE]: skippedJob })[0]?.blocked[0]?.blocker).toBe("job flake sets if: false");
});

test("the scheduled report names each command no schedule runs, and the declaration holds plain commands", () => {
  expect(formatScheduledReport(FLAKE_DECLARATION, scheduledGapsIn({ [FLAKE]: SCHEDULED }))).toBe(
    "ci-wiring: 1 scheduled command(s) run on a schedule",
  );
  expect(formatScheduledReport(FLAKE_DECLARATION, scheduledGapsIn({ [CI]: RESTORED }))).toBe(
    [
      "ci-wiring: 1 of 1 scheduled command(s) do not run on a schedule:",
      "  bunx checks-flake --report flake-report.json",
      "    no run step invokes it",
    ].join("\n"),
  );

  expect(DECLARATION.scheduled).toEqual([]);
  expect(() => declared({ gates: { ci: ["x"], scheduled: ["a && b"] } })).toThrow(WiringError);
  expect(() => declared({ gates: { ci: ["x"], scheduled: "bunx checks-flake" } })).toThrow(QualityUnreadable);
});

test("a workflow that is not YAML is refused", () => {
  expect(() => parsed(CI, "jobs: [")).toThrow(WiringError);
});

test("this repository's own CI runs its declared gates and its flake run, and loses lint without the lint step", async () => {
  const root = resolve(import.meta.dir, "..");
  const [declaration, workflows] = await Effect.runPromise(
    Effect.all([readDeclaration(root), readWorkflows(root)]).pipe(Effect.provide(BunServices.layer)),
  );
  expect(findGaps(declaration, workflows)).toEqual([]);
  expect(declaration.scheduled.map((command) => command.command)).toEqual(["bun scripts/flake.ts --runs 10 --report flake-report.json"]);
  expect(findScheduledGaps(declaration, workflows)).toEqual([]);

  const ci = readFileSync(resolve(root, CI), "utf8");
  const withoutLint = workflows.map((workflow) =>
    workflow.path === CI ? parsed(CI, mutate(ci, "      - run: bun run lint\n", "")) : workflow,
  );
  expect(findGaps(declaration, withoutLint).map((gap) => gap.gate)).toEqual(["bun run lint"]);
});
