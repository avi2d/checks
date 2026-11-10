import { expect, test } from "bun:test";
import { findStepFaults, isJudged, report, runFaults, type YamlFile } from "../../../src/delivery/plain-steps.ts";

const HINT = "run one command, or call a shared workflow or action that holds the logic:";

function yamlFile(path: string, text: string): YamlFile {
  return { path, document: Bun.YAML.parse(text), text };
}

function workflow(steps: string, on = "on: pull_request"): YamlFile {
  return yamlFile(".github/workflows/ci.yml", [on, "jobs:", "  smoke:", "    runs-on: ubuntu-latest", "    steps:", steps].join("\n"));
}

function compositeAction(...step: readonly string[]): YamlFile {
  return yamlFile("actions/slot/action.yml", ["name: slot", "runs:", "  using: composite", "  steps:", "    - shell: bash", ...step.map((line) => `      ${line}`)].join("\n"));
}

const LATE = "a command named only at run time";

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

test("a run behind a YAML anchor is refused instead of passing as one trimmed line", () => {
  const anchored = yamlFile(
    ".github/workflows/ci.yml",
    ["on: pull_request", "x-steps: &steps", "  - run: |", "      bun test", "jobs:", "  smoke:", "    runs-on: ubuntu-latest", "    steps: *steps"].join("\n"),
  );
  expect(findStepFaults([anchored])).toEqual([{ location: ".github/workflows/ci.yml job smoke step 1", faults: ["a run the check cannot locate in the file"] }]);
});

test("a run in a flow-style steps list is refused instead of passing as one trimmed line", () => {
  const flow = yamlFile(".github/workflows/ci.yml", ["on: pull_request", "jobs:", "  smoke:", "    runs-on: ubuntu-latest", `    steps: [{run: "bun test\\n"}]`].join("\n"));
  expect(findStepFaults([flow])).toEqual([{ location: ".github/workflows/ci.yml job smoke step 1", faults: ["a run the check cannot locate in the file"] }]);
});

test("a PowerShell file call passes instead of being read as inline code", () => {
  expect(runFaults("pwsh -NoProfile -File scripts/a.ps1", undefined)).toEqual([]);
  expect(runFaults("powershell -ExecutionPolicy Bypass -File a.ps1", undefined)).toEqual([]);
});

test("a PowerShell command call is refused instead of hiding behind an option value", () => {
  expect(runFaults("pwsh -ExecutionPolicy Bypass -Command Get-Date", undefined)).toEqual(["inline interpreter code"]);
  expect(runFaults("powershell -NoProfile -ExecutionPolicy Bypass -c 'a; b'", undefined)).toEqual(["inline interpreter code"]);
});

test("a shell behind timeout, xargs, find, npx or docker run is refused instead of passing as one wrapper call", () => {
  for (const run of [
    "timeout 600 bash -c 'bun install && bun test'",
    "xargs -a list.txt sh -c 'bun x'",
    "find . -exec sh -c 'echo hi' ';'",
    "npx -c 'bun install && bun test'",
    "docker run --rm --pull always node:20 sh -c 'a && b'",
    "docker run --platform linux/amd64 node:20 node -e 'x;y'",
  ]) {
    expect(runFaults(run, undefined)).toEqual(["inline interpreter code"]);
  }
  expect(runFaults("docker run -e FOO=bar ubuntu bun run test", undefined)).toEqual([]);
});

test("a bundled option value is skipped instead of ending the search before the inline flag", () => {
  for (const run of ["bash -eo pipefail -c 'a && b'", "bash -euo pipefail -c 'x'", "sh -eo pipefail -c 'a && b'", "bash -o pipefail -c 'a && b'", "node -r tsx -e 'x'", "bun --cwd app -e 'x;y'"]) {
    expect(runFaults(run, undefined)).toEqual(["inline interpreter code"]);
  }
});

test("a module taken as an option value is not read as an inline flag", () => {
  expect(runFaults("ruby -rset scripts/a.rb", undefined)).toEqual([]);
  expect(runFaults("perl -Mfeature scripts/a.pl", undefined)).toEqual([]);
});

test("a package or script name is not read as the interpreter it names", () => {
  expect(runFaults("sudo apt-get install -y gawk", undefined)).toEqual([]);
  expect(runFaults("brew install gawk", undefined)).toEqual([]);
  expect(runFaults("bun run eval", undefined)).toEqual([]);
  expect(runFaults("bun scripts/x.ts sed", undefined)).toEqual([]);
  expect(runFaults("sed --file=prog.sed in.txt", undefined)).toEqual([]);
});

test("a Windows program name and a cmd switch are judged like their bare names", () => {
  expect(runFaults("powershell.exe -Command 'a; b'", undefined)).toEqual(["inline interpreter code"]);
  expect(runFaults("pwsh.exe -c 'a; b'", undefined)).toEqual(["inline interpreter code"]);
  expect(runFaults("cmd /c 'bun install && bun test'", undefined)).toEqual(["inline interpreter code"]);
});

test("a PowerShell encoded or with-args alias is refused instead of passing as an unknown switch", () => {
  for (const run of ["pwsh -ec ZQBjAGgAbwA=", "powershell -ec ZQBjAGgAbwA=", "pwsh -cwa 'Write-Host a; b'"]) {
    expect(runFaults(run, undefined)).toEqual(["inline interpreter code"]);
  }
});

test("an uppercase flag that selects encoding or noclobber is not read as inline code", () => {
  expect(runFaults("ruby -E UTF-8 scripts/a.rb", undefined)).toEqual([]);
  expect(runFaults("bash -C scripts/a.sh", undefined)).toEqual([]);
  expect(runFaults("perl -E 'say 1'", undefined)).toEqual(["inline interpreter code"]);
});

test("an environment assignment before the program is not read as the program", () => {
  expect(runFaults("NODE_AUTH_TOKEN=${{ secrets.NPM_TOKEN }} npm publish", undefined)).toEqual([]);
  expect(runFaults("FOO=$BAR bun test", undefined)).toEqual([]);
  expect(runFaults("sudo $CMD", undefined)).toEqual(["a command named only at run time"]);
});

test("a bash and-redirect is named a redirect instead of a background job", () => {
  expect(runFaults("bun test &> out", undefined)).toEqual(["a redirect"]);
});

test("a shell from an expression is reported as unreadable instead of naming its first word", () => {
  expect(runFaults("print", "${{ matrix.shell }}")).toEqual(["a shell the check cannot read"]);
});

test("a shell through an absolute launcher path is refused instead of slipping past the launcher match", () => {
  expect(runFaults("/usr/bin/env bash -c 'a && b'", undefined)).toEqual(["inline interpreter code"]);
});

test("a wrapper outside the documented set is not judged instead of refused as inline code", () => {
  expect(runFaults("stdbuf -oL bash -c 'x'", undefined)).toEqual([]);
});

test("a php per-line code flag is refused instead of passed as an unknown flag", () => {
  for (const run of ["php -R 'echo 1;'", "php -B 'echo 1;'", "php -E 'echo 1;'"]) {
    expect(runFaults(run, undefined)).toEqual(["inline interpreter code"]);
  }
});

test("a ruby encoding value is skipped instead of ending the search before -e", () => {
  expect(runFaults("ruby -E UTF-8 -e 'puts 1; exit'", undefined)).toEqual(["inline interpreter code"]);
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

test("a reusable workflow step that runs one caller input passes instead of being refused as a command named at run time", () => {
  for (const on of ["on: workflow_call", "on: [workflow_call]", "on:\n  workflow_call:\n    inputs:\n      publish-command:\n        type: string"]) {
    expect(findStepFaults([workflow("      - run: ${{ inputs.publish-command }}", on)])).toEqual([]);
  }
});

test("a composite action step that runs one caller input passes instead of being refused as a command named at run time", () => {
  expect(findStepFaults([compositeAction("run: ${{inputs.command}}")])).toEqual([]);
});

test("a composite action step whose program is an env variable set from one caller input passes, while its arguments are still judged", () => {
  expect(findStepFaults([compositeAction("env:", "  ACTION: ${{ inputs.action }}", "  COMMAND: ${{ inputs.command }}", `run: '"$COMMAND" "$ACTION"'`)])).toEqual([]);
  expect(findStepFaults([compositeAction("env:", "  COMMAND: ${{ inputs.command }}", "run: ${COMMAND} acquire")])).toEqual([]);
  expect(findStepFaults([compositeAction("env:", "  COMMAND: ${{ inputs.command }}", `run: '"$COMMAND" acquire | tee out'`)])).toEqual([
    { location: "actions/slot/action.yml line 8 step 1", faults: ["a pipe"] },
  ]);
});

test("a caller input run in a workflow that is not only called is refused instead of trusted as the caller's command", () => {
  for (const on of ["on: pull_request", "on: [workflow_call, workflow_dispatch]"]) {
    expect(findStepFaults([workflow("      - run: ${{ inputs.publish-command }}", on)])).toEqual([{ location: ".github/workflows/ci.yml line 6 job smoke step 1", faults: [LATE] }]);
  }
});

test("an expression that is not one bare caller input is refused even in a reusable workflow", () => {
  for (const run of ["${{ matrix.command }}", "${{ github.event.inputs.command }}", "${{ inputs.a || inputs.b }}", "${{ inputs.a }}${{ inputs.b }}", "${{ inputs.a }} --verbose", "sudo ${{ inputs.a }}"]) {
    expect(runFaults(run, undefined, { kind: "reusable" })).toEqual([LATE]);
  }
  expect(runFaults("${{ inputs.a }} && bun test", undefined, { kind: "reusable" })).toEqual(["a command list", LATE]);
});

test("a program variable is refused unless the step's own env sets it from exactly one caller input", () => {
  const steps = [
    compositeAction("env:", "  COMMAND: ${{ github.head_ref }}", `run: '"$COMMAND"'`),
    compositeAction("env:", "  COMMAND: bun ${{ inputs.command }}", `run: '"$COMMAND"'`),
    compositeAction("env:", "  COMMAND: ${{ inputs.command }}", `run: '"$OTHER"'`),
    compositeAction("env:", "  COMMAND: ${{ inputs.command }}", `run: "'$COMMAND'"`),
    compositeAction("env:", "  COMMAND: ${{ inputs.command }}", `run: sudo "$COMMAND"`),
  ];
  for (const step of steps) expect(findStepFaults([step])).toEqual([{ location: "actions/slot/action.yml line 8 step 1", faults: [LATE] }]);
  expect(findStepFaults([workflow(["      - env:", "          COMMAND: ${{ inputs.command }}", `        run: '"$COMMAND"'`].join("\n"), "on: workflow_call")])).toEqual([
    { location: ".github/workflows/ci.yml line 8 job smoke step 1", faults: [LATE] },
  ]);
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
