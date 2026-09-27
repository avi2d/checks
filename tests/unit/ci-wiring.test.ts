import { expect, test } from "bun:test";
import { Effect } from "effect";
import { declarationFor, findGaps, formatReport, parseWorkflow, requiredCommands } from "../../scripts/ci-wiring.ts";

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
