import { expect, test } from "bun:test";
import { findStepFaults, isJudged, report, runFaults, type YamlFile } from "../../../src/delivery/plain-steps.ts";

const HINT = "run one command, or call a shared workflow or action that holds the logic:";

function yamlFile(path: string, text: string): YamlFile {
  return { path, document: Bun.YAML.parse(text), text };
}

function workflow(steps: string): YamlFile {
  return yamlFile(".github/workflows/ci.yml", ["on: pull_request", "jobs:", "  smoke:", "    runs-on: ubuntu-latest", "    steps:", steps].join("\n"));
}

test("the printf that appends to GITHUB_OUTPUT is refused rather than passed as one printf call", () => {
  const run = String.raw`printf 'json={"names":["%b"]}\n' 'smoke\x2dpack\x2dterm' >> "$GITHUB_OUTPUT"`;
  expect(runFaults(run, undefined)).toEqual(["a backslash escape", "a redirect"]);
});

test("a block scalar is refused even when it holds a single command", () => {
  const literal = workflow(["      - name: Smoke", "        run: |", "          bun scripts/smoke-pack.ts"].join("\n"));
  const folded = workflow(["      - name: Smoke", "        run: >", "          bun scripts/smoke-pack.ts"].join("\n"));
  expect(findStepFaults([literal])).toEqual([{ location: '.github/workflows/ci.yml line 7 job smoke step "Smoke"', faults: ["a block scalar"] }]);
  expect(findStepFaults([folded])).toEqual([{ location: '.github/workflows/ci.yml line 7 job smoke step "Smoke"', faults: ["a block scalar"] }]);
});

test("one command and calls to a shared workflow or action pass instead of being read as missing scripts", () => {
  const steps = workflow(
    [
      "      - uses: avi2d/workflows/actions/setup@v1",
      "      - name: Smoke",
      "        run: bun scripts/smoke-pack.ts",
      "  shared:",
      "    uses: avi2d/workflows/.github/workflows/mutation.yml@v1",
    ].join("\n"),
  );
  expect(findStepFaults([steps])).toEqual([]);
});

test("each shell construct the gate docs name is refused instead of slipping through as words", () => {
  expect(runFaults("bun run build | tee build.log", undefined)).toEqual(["a pipe"]);
  expect(runFaults("bun install && bun run test", undefined)).toEqual(["a command list"]);
  expect(runFaults("bun install; bun run test", undefined)).toEqual(["a command list"]);
  expect(runFaults("bun run test > out.txt", undefined)).toEqual(["a redirect"]);
  expect(runFaults("echo $(git rev-parse HEAD)", undefined)).toEqual(["a command substitution"]);
  expect(runFaults("echo `git rev-parse HEAD`", undefined)).toEqual(["a command substitution"]);
  expect(runFaults("cat <<EOF", undefined)).toEqual(["a here-document"]);
});

test("inline interpreter code is refused rather than counted as one command", () => {
  for (const run of [
    "node -e 'console.log(1)'",
    "bun --eval 'console.log(1)'",
    "bash -c 'bun run test'",
    "bash -ec 'bun run test'",
    "python3 -c 'print(1)'",
    "deno eval 'console.log(1)'",
  ]) {
    expect(runFaults(run, undefined)).toEqual(["inline interpreter code"]);
  }
});

test("a flag after the script belongs to the script and is not read as inline code", () => {
  expect(runFaults("bun scripts/smoke-pack.ts -e staging", undefined)).toEqual([]);
  expect(runFaults("bash scripts/smoke.sh -c", undefined)).toEqual([]);
});

test("an expression argument passes, and an operator inside it is not read as shell", () => {
  expect(runFaults("bun scripts/smoke-pack.ts --ref ${{ github.head_ref || github.ref_name }}", undefined)).toEqual([]);
  expect(runFaults("bun scripts/smoke-pack.ts \"$RUNNER_TEMP\" ${RUNNER_OS}", undefined)).toEqual([]);
});

test("a command that comes from an expression is refused, since no one can read it before the run", () => {
  expect(runFaults("${{ inputs.command }}", undefined)).toEqual(["a command named only at run time"]);
});

test("a step whose shell is an interpreter is refused even when its run is one line", () => {
  expect(runFaults("print", "python")).toEqual(["inline code for the python shell"]);
  expect(runFaults("bun run test", "bash --noprofile --norc -eo pipefail {0}")).toEqual([]);
});

test("a run spread over lines of a quoted scalar is refused although YAML folds it into one line", () => {
  const folded = workflow(["      - name: Smoke", '        run: "bun scripts/smoke-pack.ts', '          --verbose"'].join("\n"));
  expect(findStepFaults([folded])).toEqual([{ location: '.github/workflows/ci.yml line 7 job smoke step "Smoke"', faults: ["more than one line"] }]);
});

test("a composite action's steps are judged and named by id or position when they carry no name", () => {
  const action = yamlFile(
    "actions/smoke/action.yml",
    ["name: smoke", "runs:", "  using: composite", "  steps:", "    - id: emit", "      shell: bash", "      run: echo done > out.txt", "    - shell: bash", "      run: bun install && bun test"].join("\n"),
  );
  expect(findStepFaults([action])).toEqual([
    { location: "actions/smoke/action.yml line 7 step emit", faults: ["a redirect"] },
    { location: "actions/smoke/action.yml line 9 step 2", faults: ["a command list"] },
  ]);
});

test("a job default shell reaches its steps instead of the bash default", () => {
  const steps = yamlFile(
    ".github/workflows/ci.yml",
    ["on: push", "defaults:", "  run:", "    shell: python", "jobs:", "  smoke:", "    steps:", "      - run: print"].join("\n"),
  );
  expect(findStepFaults([steps])).toEqual([{ location: ".github/workflows/ci.yml line 8 job smoke step 1", faults: ["inline code for the python shell"] }]);
});

test("only top-level workflows and action files are judged, outside installed trees and fixtures", () => {
  expect([".github/workflows/ci.yml", ".github/workflows/release.yaml", "action.yml", "actions/setup/action.yaml"].every(isJudged)).toBe(true);
  for (const file of [".github/workflows/nested/ci.yml", ".github/dependabot.yml", "node_modules/pkg/action.yml", "tests/fixtures/action.yml", "docs/ci.yml"]) {
    expect(isJudged(file)).toBe(false);
  }
});

test("the report says how to turn the gate on when it is off, and names every step it refuses when on", () => {
  expect(report({ enabled: false, violations: [] })).toBe("plain-steps: off; set checks.plainSteps to true in package.json to turn it on");
  expect(report({ enabled: true, files: 2, violations: [] })).toBe("plain-steps: every run step in 2 workflow or action file(s) is one plain command");
  expect(report({ enabled: true, files: 1, violations: [{ location: "action.yml line 4 step 1", faults: ["a pipe", "a redirect"] }] })).toBe(
    `plain-steps: 1 run step(s) are not one plain command; ${HINT}\n  action.yml line 4 step 1: a pipe, a redirect`,
  );
});
