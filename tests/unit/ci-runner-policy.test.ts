import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseWorkflow } from "../../src/delivery/ci-wiring.ts";
import { findRunnerFaults, formatRunnerReport, type RunnerConfig } from "../../src/delivery/runner-policy.ts";

function workflow(text: string) {
  return [Effect.runSync(parseWorkflow(".github/workflows/ci.yml", text))];
}

function named(path: string, text: string) {
  return Effect.runSync(parseWorkflow(path, text));
}


const MUTATION = "[self-hosted, gpu, x64]";
const DEVICE = "[self-hosted, macOS, device]";
const HOSTED = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
const OLD_DEFAULT = `\${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","gpu"]') }}`;
const noScripts = new Map<string, string>();
const RUNNERS: RunnerConfig = { mutation: ["self-hosted", "gpu", "x64"], selfHosted: [["self-hosted", "macOS", "device"]] };
const NO_RUNNERS: RunnerConfig = { mutation: undefined, selfHosted: [] };

function jobs(mutationRunsOn: string, checksRunsOn: string) {
  return workflow(`on: pull_request\njobs:\n  mutation:\n    runs-on: ${mutationRunsOn}\n    steps:\n      - run: bunx stryker run\n  checks:\n    runs-on: ${checksRunsOn}\n    steps:\n      - run: bun run lint\n`);
}

test("a private repository pins mutation jobs to its configured labels and defaults every other job to a hosted runner", () => {
  expect(findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, HOSTED))).toEqual([]);
  const old = findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, jobs(OLD_DEFAULT, OLD_DEFAULT));
  expect(old.map(({ location }) => location)).toEqual([".github/workflows/ci.yml job mutation", ".github/workflows/ci.yml job checks"]);
  expect(old[0]?.fault).toContain("reads CI_RUNS_ON");
  expect(old[1]?.fault).toContain(HOSTED);
  const plain = findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, jobs("ubuntu-latest", "ubuntu-latest"));
  expect(plain.map(({ fault }) => fault)).toEqual([expect.stringContaining(MUTATION), expect.stringContaining(HOSTED)]);
});

test("a private repository admits a non-mutation job on the self-hosted device labels", () => {
  const device = workflow(`on: pull_request\njobs:\n  device:\n    runs-on: [self-hosted, macOS, device]\n    steps:\n      - run: bun run lint\n`);
  expect(findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, device)).toEqual([]);
});

test("a private repository still refuses other fixed self-hosted runs-on", () => {
  for (const runsOn of ["[self-hosted, macOS]", "[self-hosted]"]) {
    const faults = findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, runsOn));
    expect(faults).toHaveLength(1);
    expect(faults[0]?.fault).toContain(HOSTED);
  }
});

test("any repository refuses a mutation job that reads CI_RUNS_ON and an override without the hosted default", () => {
  for (const visibility of ["public", "unknown"] as const) {
    expect(findRunnerFaults({ visibility, scripts: noScripts, runners: RUNNERS }, jobs("ubuntu-latest", "ubuntu-latest"))).toEqual([]);
    expect(findRunnerFaults({ visibility, scripts: noScripts, runners: RUNNERS }, jobs(HOSTED, OLD_DEFAULT)).length).toBe(2);
  }
  expect(findRunnerFaults({ visibility: "unknown", scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, HOSTED))).toEqual([]);
});

test("a package script, a kit bin or a prefixed stryker run marks the job as a mutation job", () => {
  const mutating = new Map([["mutate", "bunx stryker run --incremental"], ["loop", "bun run loop"]]);
  for (const step of ["bun run mutate", "time bunx stryker run --mutate src", "./node_modules/.bin/checks-mutation-compare a b", "bun run checks-mutation"]) {
    const faults = findRunnerFaults({ visibility: "private", scripts: mutating, runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${step}\n`));
    expect(faults[0]?.fault).toContain(MUTATION);
  }
  const looping = workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: bun run loop\n`);
  expect(findRunnerFaults({ visibility: "private", scripts: mutating, runners: RUNNERS }, looping)).toEqual([]);
});

test("quoted words and line continuations still mark a mutation job, and a shell comment does not", () => {
  const mutating = new Map([["mutate", "bunx 'stryker' \\\n  run"]]);
  const sweep = (run: string) => findRunnerFaults({ visibility: "private", scripts: mutating, runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`));
  for (const run of ['bun run "mutate"', "bun run mutate", '"./node_modules/.bin/checks-mutation"', "bunx stryker \\\n  run", "echo start\nbunx stryker run"]) {
    expect(sweep(run)[0]?.fault).toContain(MUTATION);
  }
  for (const run of ["bun run lint\n# bunx stryker run", "bun run lint # bunx stryker run", "echo 'bunx stryker run'"]) {
    expect(sweep(run)).toEqual([]);
  }
});

test("only a command's program marks a mutation job, wherever the shell runs that command", () => {
  const mutating = new Map([["mutate", 'out="$(bunx stryker run)"']]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: mutating, runners: RUNNERS },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ['output="$(bunx stryker run)"', 'echo "`checks-mutation`"', "bun run mutate", ">log.txt 2>&1 checks-mutation a b", "if bunx stryker run; then echo ok; fi"]) {
    expect(sweep(run)[0]?.fault).toContain(MUTATION);
  }
  for (const run of ["echo 'checks-mutation'", "bun run lint > checks-mutation.log", "echo stryker run"]) {
    expect(sweep(run)).toEqual([]);
  }
});

test("bracket access or any case of CI_RUNS_ON still reads the override", () => {
  for (const override of ["${{ vars['CI_RUNS_ON'] || 'ubuntu-latest' }}", "${{ VARS.ci_runs_on || 'ubuntu-latest' }}"]) {
    expect(findRunnerFaults({ visibility: "unknown", scripts: noScripts, runners: RUNNERS }, jobs(override, "ubuntu-latest"))[0]?.fault).toContain("reads CI_RUNS_ON");
    const refused = findRunnerFaults({ visibility: "public", scripts: noScripts, runners: RUNNERS }, jobs(override, "ubuntu-latest"));
    expect(refused).toHaveLength(1);
    expect(refused[0]?.location).toBe(".github/workflows/ci.yml job mutation");
    expect(refused[0]?.fault).toContain("cannot be shown");
    for (const visibility of ["public", "unknown"] as const) {
      expect(findRunnerFaults({ visibility, scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, override.replace("'ubuntu-latest'", "fromJSON('[\"self-hosted\"]')")))).toHaveLength(visibility === "public" ? 2 : 1);
    }
  }
});

test("bun reaches a package script with or without run and past its own options", () => {
  const mutating = new Map([["mutate", "bunx stryker run"], ["test", "bunx stryker run"]]);
  const sweep = (run: string) => findRunnerFaults({ visibility: "private", scripts: mutating, runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`));
  for (const run of ["bun mutate", "bun --cwd . run mutate", "bun run --cwd . mutate", "bun --cwd . x stryker run", "env -u HOME bun run mutate", "bun run test"]) {
    expect(sweep(run)[0]?.fault).toContain(MUTATION);
  }
  for (const run of ["bun test", "bun --cwd mutate run lint", "sudo -u stryker run-parts"]) {
    expect(sweep(run)).toEqual([]);
  }
});

const GUIDE = "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions";

test(`a public repository refuses any self-hosted label on a fork-reachable job (oracle: GitHub's hardening guide ${GUIDE})`, () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  for (const runsOn of [MUTATION, DEVICE, "[self-hosted]", "self-hosted", "[Self-Hosted, gpu]"]) {
    const faults = findRunnerFaults(policy, jobs(runsOn, runsOn));
    expect(faults).toHaveLength(2);
    for (const fault of faults) expect(fault.fault).toContain("self-hosted labels");
  }
  const grouped = workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on:\n      group: fleet\n      labels: [self-hosted, gpu]\n    steps:\n      - run: bunx stryker run\n`);
  expect(findRunnerFaults(policy, grouped)).toHaveLength(1);
  for (const on of ["pull_request_review", "pull_request_review_comment"]) {
    const review = workflow("on: " + on + "\njobs:\n  sweep:\n    runs-on: " + MUTATION + "\n    steps:\n      - run: bun run lint\n");
    const reviewFaults = findRunnerFaults(policy, review);
    expect(reviewFaults).toHaveLength(1);
    expect(reviewFaults[0]?.fault).toContain("self-hosted labels");
  }
  const hidden = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: ${{ fromJSON('[\"self-hosted\",\"gpu\"]') }}\n    steps:\n      - run: bun run lint\n");
  const hiddenFaults = findRunnerFaults(policy, hidden);
  expect(hiddenFaults).toHaveLength(1);
  expect(hiddenFaults[0]?.fault).toContain("self-hosted labels");
  const bare = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on:\n      group: fleet\n    steps:\n      - run: bun run lint\n");
  const bareFaults = findRunnerFaults(policy, bare);
  expect(bareFaults).toHaveLength(1);
  expect(bareFaults[0]?.fault).toContain("runner group fleet");
  const custom: RunnerConfig = { mutation: undefined, selfHosted: [["gpu", "custom"]] };
  const claimed = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: [gpu, custom]\n    steps:\n      - run: bun run lint\n");
  const claimedFaults = findRunnerFaults({ visibility: "public" as const, scripts: noScripts, runners: custom }, claimed);
  expect(claimedFaults).toHaveLength(1);
  expect(claimedFaults[0]?.fault).toContain("self-hosted labels");
  const hostedDefault = findRunnerFaults(policy, jobs("ubuntu-latest", HOSTED));
  expect(hostedDefault).toHaveLength(1);
  expect(hostedDefault[0]?.location).toBe(".github/workflows/ci.yml job checks");
  expect(hostedDefault[0]?.fault).toContain("cannot be shown");
});

test("a public repository keeps self-hosted labels on jobs no fork reaches", () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const push = workflow(`on: push\njobs:\n  sweep:\n    runs-on: ${MUTATION}\n    steps:\n      - run: bunx stryker run\n`);
  expect(findRunnerFaults(policy, push)).toEqual([]);
  const target = workflow(`on:\n  pull_request_target:\n    types: [opened]\njobs:\n  checks:\n    runs-on: ${MUTATION}\n    steps:\n      - run: bun run lint\n`);
  expect(findRunnerFaults(policy, target)).toHaveLength(1);
});

test("a private repository without checks.mutationRunner fails each mutation job until it declares those labels", () => {
  const policy = { visibility: "private" as const, scripts: noScripts, runners: NO_RUNNERS };
  const faults = findRunnerFaults(policy, jobs(MUTATION, HOSTED));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.location).toBe(".github/workflows/ci.yml job mutation");
  expect(faults[0]?.fault).toContain("checks.mutationRunner");
});

test("a private repository without checks.selfHostedRunners holds every other job to the hosted default", () => {
  const policy = { visibility: "private" as const, scripts: noScripts, runners: { mutation: RUNNERS.mutation, selfHosted: [] } };
  const device = workflow(`on: pull_request\njobs:\n  device:\n    runs-on: ${DEVICE}\n    steps:\n      - run: bun run lint\n`);
  const faults = findRunnerFaults(policy, device);
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain(HOSTED);
});

test("the hosted default matches the override in any form the override check accepts, and only ubuntu-latest", () => {
  for (const visibility of ["private", "unknown"] as const) {
    for (const hosted of ["${{ vars['CI_RUNS_ON'] || 'ubuntu-latest' }}", "${{ VARS.ci_runs_on||'ubuntu-latest' }}"]) {
      expect(findRunnerFaults({ visibility, scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, hosted))).toEqual([]);
    }
    expect(findRunnerFaults({ visibility, scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, "${{ vars.CI_RUNS_ON || 'ubuntu -latest' }}"))).toHaveLength(1);
  }
  for (const hosted of ["${{ vars['CI_RUNS_ON'] || 'ubuntu-latest' }}", "${{ VARS.ci_runs_on||'ubuntu-latest' }}"]) {
    const faults = findRunnerFaults({ visibility: "public", scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, hosted));
    expect(faults).toHaveLength(2);
    expect(faults[0]?.fault).toContain("self-hosted labels");
    expect(faults[1]?.fault).toContain("cannot be shown");
  }
  expect(findRunnerFaults({ visibility: "public", scripts: noScripts, runners: RUNNERS }, jobs(MUTATION, "${{ vars.CI_RUNS_ON || 'ubuntu -latest' }}"))).toHaveLength(2);
});

test("a public repository resolves matrix runs-on and refuses only self-hosted or unresolvable values (oracle: GitHub's hardening guide https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)", () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const matrix = (os: string) =>
    workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [" + os + "]\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, matrix("ubuntu-latest, windows-latest"))).toEqual([]);
  const hosted = findRunnerFaults(policy, matrix("self-hosted, linux"));
  expect(hosted).toHaveLength(1);
  expect(hosted[0]?.fault).toContain("self-hosted labels");
  const bare = findRunnerFaults(policy, workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n"));
  expect(bare).toHaveLength(1);
  expect(bare[0]?.fault).toContain("cannot be shown");
  const opaque = findRunnerFaults(policy, workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: ${{ github.event.inputs.runs-on }}\n    steps:\n      - run: bun run lint\n"));
  expect(opaque).toHaveLength(1);
  expect(opaque[0]?.fault).toContain("cannot be shown");
  const fleet = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        runner: ['[\"self-hosted\",\"gpu\"]']\n    runs-on: ${{ fromJSON(matrix.runner) }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, fleet)).toHaveLength(1);
  const picked = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [linux, mac]\n    runs-on: ${{ matrix.os == 'linux' && 'self-hosted' || 'ubuntu-latest' }}\n    steps:\n      - run: bun run lint\n");
  const pickedFaults = findRunnerFaults(policy, picked);
  expect(pickedFaults).toHaveLength(1);
  expect(pickedFaults[0]?.fault).toContain("self-hosted labels");
  const shadowed = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest]\n    runs-on: ${{ vars.RUNNER || matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const shadowedFaults = findRunnerFaults(policy, shadowed);
  expect(shadowedFaults).toHaveLength(1);
  expect(shadowedFaults[0]?.fault).toContain("cannot be shown");
  const added = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        include:\n          - os: ubuntu-latest\n          - os: windows-latest\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, added)).toEqual([]);
  const narrowed = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n        exclude:\n          - os: self-hosted\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, narrowed)).toEqual([]);
  const kept = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n        arch: [x64, arm]\n        exclude:\n          - os: self-hosted\n            arch: arm\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const keptFaults = findRunnerFaults(policy, kept);
  expect(keptFaults).toHaveLength(1);
  expect(keptFaults[0]?.fault).toContain("self-hosted labels");
  const readded = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n        exclude:\n          - os: self-hosted\n        include:\n          - os: self-hosted\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const readdedFaults = findRunnerFaults(policy, readded);
  expect(readdedFaults).toHaveLength(1);
  expect(readdedFaults[0]?.fault).toContain("self-hosted labels");
  const cleared = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n        arch: [x64, arm]\n        exclude:\n          - os: self-hosted\n            arch: x64\n          - os: self-hosted\n            arch: arm\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, cleared)).toEqual([]);
});

test("a public repository resolves include-only rows, scalar axes and labels mappings (oracle: GitHub's hardening guide https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)", () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const scalar = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on:\n      labels: ubuntu-latest\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, scalar)).toEqual([]);
  const scalarSelf = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on:\n      labels: self-hosted\n    steps:\n      - run: bun run lint\n");
  const scalarSelfFaults = findRunnerFaults(policy, scalarSelf);
  expect(scalarSelfFaults).toHaveLength(1);
  expect(scalarSelfFaults[0]?.fault).toContain("self-hosted labels");
  const numbered = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest]\n        node: [20, 22]\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, numbered)).toEqual([]);
  const merged = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        version: ['20', '22']\n        include:\n          - os: self-hosted\n          - os: ubuntu-latest\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, merged)).toEqual([]);
  const numberedKept = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n        node: [20, 22]\n        exclude:\n          - os: self-hosted\n            node: 20\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const numberedKeptFaults = findRunnerFaults(policy, numberedKept);
  expect(numberedKeptFaults).toHaveLength(1);
  expect(numberedKeptFaults[0]?.fault).toContain("self-hosted labels");
  const mixed = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        include:\n          - os: self-hosted\n          - os: ubuntu-latest\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const mixedFaults = findRunnerFaults(policy, mixed);
  expect(mixedFaults).toHaveLength(1);
  expect(mixedFaults[0]?.fault).toContain("self-hosted labels");
  const overwritten = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        arch: [x64]\n        include:\n          - arch: x64\n            os: self-hosted\n          - arch: x64\n            os: ubuntu-latest\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, overwritten)).toEqual([]);
});

test(`a public fork-reachable job refuses a subset of a declared label set (oracle: GitHub's hardening guide ${GUIDE})`, () => {
  const runners: RunnerConfig = { mutation: ["self-hosted", "Linux", "X64", "mutation-box"], selfHosted: [] };
  const job = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: mutation-box\n    steps:\n      - run: bun run lint\n");
  const faults = findRunnerFaults({ visibility: "public" as const, scripts: noScripts, runners }, job);
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain("self-hosted labels");
  const boxed: RunnerConfig = { mutation: undefined, selfHosted: [["gpu-box"]] };
  const matrix = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, gpu-box]\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const boxedFaults = findRunnerFaults({ visibility: "public" as const, scripts: noScripts, runners: boxed }, matrix);
  expect(boxedFaults).toHaveLength(1);
  expect(boxedFaults[0]?.fault).toContain("self-hosted labels");
});

test(`a public fork-reachable job refuses a declared label set in any case (oracle: GitHub's self-hosted runner labels https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/using-labels-with-self-hosted-runners)`, () => {
  const runners: RunnerConfig = { mutation: ["self-hosted", "Linux", "X64", "mutation-box"], selfHosted: [] };
  const loud = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: MUTATION-BOX\n    steps:\n      - run: bun run lint\n");
  const loudFaults = findRunnerFaults({ visibility: "public" as const, scripts: noScripts, runners }, loud);
  expect(loudFaults).toHaveLength(1);
  expect(loudFaults[0]?.fault).toContain("self-hosted labels");
  const boxed: RunnerConfig = { mutation: undefined, selfHosted: [["gpu-box"]] };
  const matrix = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: [ubuntu-latest, GPU-BOX]\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults({ visibility: "public" as const, scripts: noScripts, runners: boxed }, matrix)).toHaveLength(1);
});

test(`a public fork-reachable mutation job is told to use ubuntu-latest (oracle: GitHub's hardening guide ${GUIDE})`, () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const hosted = findRunnerFaults(policy, jobs(HOSTED, "ubuntu-latest"));
  expect(hosted).toHaveLength(1);
  expect(hosted[0]?.location).toBe(".github/workflows/ci.yml job mutation");
  expect(hosted[0]?.fault).toContain("set runs-on: ubuntu-latest");
  const pinned = findRunnerFaults(policy, jobs(MUTATION, "ubuntu-latest"));
  expect(pinned).toHaveLength(1);
  expect(pinned[0]?.fault).toContain("set runs-on: ubuntu-latest");
  expect(pinned[0]?.fault).not.toContain("CI_RUNS_ON");
});

test(`a public fork-reachable job refuses labels that interpolate an expression (oracle: GitHub's hardening guide ${GUIDE})`, () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const partial = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: self-${{ vars.KIND }}\n    steps:\n      - run: bun run lint\n");
  const partialFaults = findRunnerFaults(policy, partial);
  expect(partialFaults).toHaveLength(1);
  expect(partialFaults[0]?.fault).toContain("cannot be shown");
  const listed = workflow("on: pull_request\njobs:\n  sweep:\n    runs-on: [\"self-${{ vars.KIND }}\"]\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, listed)).toHaveLength(1);
  const viaMatrix = workflow("on: pull_request\njobs:\n  sweep:\n    strategy:\n      matrix:\n        os: ['${{ vars.RUNNER }}']\n    runs-on: ${{ matrix.os }}\n    steps:\n      - run: bun run lint\n");
  const viaMatrixFaults = findRunnerFaults(policy, viaMatrix);
  expect(viaMatrixFaults).toHaveLength(1);
  expect(viaMatrixFaults[0]?.fault).toContain("cannot be shown");
});

test(`a workflow_run trigger on a fork-reachable workflow is fork-reachable (oracle: GitHub's hardening guide ${GUIDE})`, () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const ci = named(".github/workflows/ci.yml", "name: CI\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n");
  const after = named(".github/workflows/after.yml", "on:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]\njobs:\n  sweep:\n    runs-on: [self-hosted, gpu]\n    steps:\n      - run: bun run lint\n");
  const faults = findRunnerFaults(policy, [ci, after]);
  expect(faults).toHaveLength(1);
  expect(faults[0]?.location).toBe(".github/workflows/after.yml job sweep");
  const push = named(".github/workflows/ci.yml", "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, [push, after])).toEqual([]);
  const comment = named(".github/workflows/comment.yml", "on: issue_comment\njobs:\n  sweep:\n    runs-on: [self-hosted, gpu]\n    steps:\n      - run: bun run lint\n");
  expect(findRunnerFaults(policy, [comment])).toHaveLength(1);
});

test("a reusable workflow called from a fork-reachable workflow is fork-reachable (oracle: GitHub's hardening guide https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)", () => {
  const policy = { visibility: "public" as const, scripts: noScripts, runners: RUNNERS };
  const caller = named(".github/workflows/ci.yml", "on: pull_request\njobs:\n  build:\n    uses: ./.github/workflows/build.yml\n");
  const called = named(".github/workflows/build.yml", "on: workflow_call\njobs:\n  sweep:\n    runs-on: " + MUTATION + "\n    steps:\n      - run: bun run lint\n");
  const faults = findRunnerFaults(policy, [caller, called]);
  expect(faults).toHaveLength(1);
  expect(faults[0]?.location).toBe(".github/workflows/build.yml job sweep");
  expect(findRunnerFaults(policy, [called])).toEqual([]);
  const push = named(".github/workflows/ci.yml", "on: push\njobs:\n  build:\n    uses: ./.github/workflows/build.yml\n");
  expect(findRunnerFaults(policy, [push, called])).toEqual([]);
  const mid = named(".github/workflows/mid.yml", "on: workflow_call\njobs:\n  next:\n    uses: ./.github/workflows/build.yml\n");
  const top = named(".github/workflows/ci.yml", "on: pull_request\njobs:\n  build:\n    uses: ./.github/workflows/mid.yml\n");
  expect(findRunnerFaults(policy, [top, mid, called])).toHaveLength(1);
});

test("the runner report names each job and what to set", () => {
  const faults = findRunnerFaults({ visibility: "private", scripts: noScripts, runners: RUNNERS }, jobs("ubuntu-latest", HOSTED));
  expect(formatRunnerReport(faults)).toBe(
    `ci-wiring: 1 job(s) run on the wrong runner:\n  .github/workflows/ci.yml job mutation: ${faults[0]?.fault}`,
  );
});

test("a package script through a repository file to stryker is a mutation job pinned to its configured labels", () => {
  const wired = new Map([["mutate:incremental", "scripts/mutate.sh --incremental"]]);
  const files = new Map([
    ["scripts/mutate.sh", 'exec ./node_modules/.bin/stryker run "$@"'],
    ["mutate.sh", "scripts/mutate.sh"],
  ]);
  const sweep = (run: string, runsOn: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: wired, files, runners: RUNNERS },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${runsOn}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  const runs = ["time bun run mutate:incremental", "scripts/mutate.sh --incremental", "./scripts/mutate.sh --incremental", "./mutate.sh", "bun run ./scripts/mutate.sh", "bun scripts/mutate.sh", "bun mutate.sh"];
  for (const run of runs) {
    expect(sweep(run, HOSTED)[0]?.fault).toContain(MUTATION);
    expect(sweep(run, MUTATION)).toEqual([]);
  }
  expect(sweep("mutate.sh", HOSTED)).toEqual([]);
});

test("a repository file without a mutation call stays a hosted job", () => {
  const wired = new Map([["generate", "scripts/generate.sh"]]);
  const files = new Map([["scripts/generate.sh", "echo done"]]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: wired, files, runners: RUNNERS },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ["bun run generate", "scripts/generate.sh", "./scripts/generate.sh"]) {
    expect(sweep(run)).toEqual([]);
  }
  expect(
    findRunnerFaults(
      { visibility: "private", scripts: wired, files, runners: RUNNERS },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${MUTATION}\n    steps:\n      - run: "bun run generate"\n`),
    )[0]?.fault,
  ).toContain(HOSTED);
});

test("a script and file cycle terminates without marking a mutation job", () => {
  const wired = new Map([["loop", "scripts/loop.sh"]]);
  const files = new Map([
    ["scripts/loop.sh", "bun run loop"],
    ["scripts/a.sh", "scripts/b.sh"],
    ["scripts/b.sh", "scripts/a.sh"],
  ]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: wired, files, runners: RUNNERS },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  expect(sweep("bun run loop")).toEqual([]);
  expect(sweep("scripts/a.sh")).toEqual([]);
  expect(sweep("scripts/missing.sh")).toEqual([]);
});

test("a package script named after the repository file it runs still reaches that file", () => {
  const wired = new Map([["scripts/mutate.sh", "scripts/mutate.sh --incremental"]]);
  const files = new Map([["scripts/mutate.sh", 'exec ./node_modules/.bin/stryker run "$@"']]);
  const sweep = (runsOn: string) =>
    findRunnerFaults({ visibility: "private", scripts: wired, files, runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${runsOn}\n    steps:\n      - run: bun run scripts/mutate.sh\n`));
  expect(sweep(HOSTED)[0]?.fault).toContain(MUTATION);
  expect(sweep(MUTATION)).toEqual([]);
});

test("a here-document's text is data, and only an unquoted one's substitutions run", () => {
  const files = new Map([
    ["scripts/help.sh", "cat <<'EOF'\nbunx stryker run\nEOF\n"],
    ["scripts/tabbed.sh", "cat <<-EOF >&2\n\tbunx stryker run\n\tEOF\necho done\n"],
    ["scripts/expanded.sh", "cat <<EOF\nsummary: $(bunx stryker run)\nEOF\n"],
    ["scripts/after.sh", "cat <<\"EOF\"\nusage\nEOF\nbunx stryker run\n"],
  ]);
  const sweep = (run: string) =>
    findRunnerFaults({ visibility: "private", scripts: new Map(), files, runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${run}\n`));
  expect(sweep("scripts/help.sh")).toEqual([]);
  expect(sweep("scripts/tabbed.sh")).toEqual([]);
  expect(sweep("scripts/expanded.sh")[0]?.fault).toContain(MUTATION);
  expect(sweep("scripts/after.sh")[0]?.fault).toContain(MUTATION);
  expect(sweep("cat <<< 'bunx stryker run'")).toEqual([]);
});

test("a here-document a shell reads is its script, quoted or not", () => {
  const sweep = (run: string) =>
    findRunnerFaults({ visibility: "private", scripts: new Map(), runners: RUNNERS }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`));
  for (const delimiter of ["'EOF'", "EOF"]) {
    expect(sweep(`bash <<${delimiter}\nset -e\nbunx stryker run\nEOF\n`)[0]?.fault).toContain(MUTATION);
    expect(sweep(`/bin/sh -s <<-${delimiter} >&2\n\tbunx stryker run\n\tEOF\n`)[0]?.fault).toContain(MUTATION);
  }
  expect(sweep("cat <<'EOF'\nbunx stryker run\nEOF\n")).toEqual([]);
  for (const delimiter of ["'EOF'", "EOF"]) {
    expect(sweep(`<<${delimiter} bash\nbunx stryker run\nEOF\n`)[0]?.fault).toContain(MUTATION);
    expect(sweep(`env <<${delimiter} bash\nbunx stryker run\nEOF\n`)[0]?.fault).toContain(MUTATION);
  }
});

test("a repository file resolves from the directory its command runs in", () => {
  const files = new Map([
    ["mutate.sh", "echo report"],
    ["tools/mutate.sh", "bunx stryker run"],
    ["tools/report.sh", "./mutate.sh"],
  ]);
  const sweep = (job: string, defaults = "") =>
    findRunnerFaults({ visibility: "private", scripts: new Map(), files, runners: RUNNERS }, workflow(`on: pull_request\n${defaults}jobs:\n  sweep:\n    runs-on: ${HOSTED}\n${job}`));
  const step = (run: string, extra = "") => `    steps:\n      - run: ${JSON.stringify(run)}\n${extra}`;
  const tools = "        working-directory: tools\n";
  const mutation = (job: string, defaults?: string) => expect(sweep(job, defaults)[0]?.fault).toContain(MUTATION);
  expect(sweep(step("./mutate.sh"))).toEqual([]);
  mutation(step("./mutate.sh", tools));
  mutation(step("../tools/mutate.sh", "        working-directory: ./docs\n"));
  mutation(`    defaults:\n      run:\n        working-directory: tools\n${step("./mutate.sh")}`);
  mutation(step("./mutate.sh"), "defaults:\n  run:\n    working-directory: tools\n");
  expect(sweep(step("./mutate.sh", "        working-directory: .\n"), "defaults:\n  run:\n    working-directory: tools\n")).toEqual([]);
  mutation(step("cd tools && ./mutate.sh"));
  expect(sweep(step("cd tools; cd ..; ./mutate.sh"))).toEqual([]);
  mutation(step("cd tools; output=`./mutate.sh`; cd .."));
  mutation(step('cd tools; output="$(./mutate.sh)"; cd ..'));
  expect(sweep(step("cd tools; cd ..; output=`./mutate.sh`"))).toEqual([]);
  mutation(step("bun --cwd=tools run ./mutate.sh"));
  mutation(step("./report.sh", tools));
  expect(sweep(step("bun --cwd=tools run ../mutate.sh"))).toEqual([]);
  expect(sweep(step("./mutate.sh", "        working-directory: ${{ github.workspace }}/tools\n"))).toEqual([]);
});

