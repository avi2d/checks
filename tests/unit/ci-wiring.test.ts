import { expect, test } from "bun:test";
import { Effect } from "effect";
import { declarationFor, findGaps, findRunnerFaults, formatReport, formatRunnerReport, parseWorkflow, requiredCommands } from "../../src/delivery/ci-wiring.ts";
import { findMissingWorkflows, formatMissingReport } from "../../src/delivery/workflow-references.ts";

const scripts = ["lint", "build", "typecheck", "test"];
const declaration = declarationFor(scripts, "main");

function workflow(text: string) {
  return [Effect.runSync(parseWorkflow(".github/workflows/ci.yml", text))];
}

const prefix = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n`;
const steps = ["bun run lint", "bun run build", "git diff --exit-code", "bun run typecheck", "bun run test", "bunx checks-commit-title"];
const full = `${prefix}${steps.map((command) => `      - run: ${command}\n`).join("")}`;

test("the kit requires title lint always and each command package.json can run", () => {
  expect(requiredCommands([])).toEqual(["bunx checks-commit-title"]);
  expect(requiredCommands(["lint", "test", "start"])).toEqual(["bun run lint", "bun run test", "bunx checks-commit-title"]);
  expect(requiredCommands(["build"])).toEqual(["bun run build", "git diff --exit-code", "bunx checks-commit-title"]);
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
  const ci = workflow(full.replace("      - run: bunx checks-commit-title\n", ""));
  const title = Effect.runSync(parseWorkflow(".github/workflows/title.yml", `${prefix}      - run: bunx checks-commit-title\n`));
  expect(findGaps(declaration, [...ci, title])).toEqual([]);
});

test("the folded title call, the own-repo call and the legacy direct call each satisfy the title gate", () => {
  const ci = workflow(full.replace("      - run: bunx checks-commit-title\n", ""));
  for (const call of ["bunx checks-commit-title", "bun src/delivery/commit-title.ts", "./node_modules/.bin/commitlint", "bun run ./node_modules/.bin/commitlint"]) {
    const title = Effect.runSync(parseWorkflow(".github/workflows/title.yml", `${prefix}      - run: ${call}\n`));
    expect(findGaps(declaration, [...ci, title])).toEqual([]);
  }
});

test("gate steps gated on a filter step still run every gate", () => {
  const gated = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun src/delivery/commit-title.ts\n      - id: filter\n        run: bun src/delivery/docs-only.ts base head >> "$GITHUB_OUTPUT"\n      - if: \${{ steps.filter.outputs.docs-only != 'true' }}\n        run: bun run lint\n      - if: \${{ steps.filter.outputs.docs-only != 'true' }}\n        run: bun run build\n      - if: \${{ steps.filter.outputs.docs-only != 'true' }}\n        run: git diff --exit-code\n      - if: \${{ steps.filter.outputs.docs-only != 'true' }}\n        run: bun run typecheck\n      - if: \${{ steps.filter.outputs.docs-only != 'true' }}\n        run: bun run test\n`;
  expect(findGaps(declaration, workflow(gated))).toEqual([]);
});

test("a test:unit and test:e2e pair satisfies the test gate, which the whole suite still satisfies alone", () => {
  const split = [...scripts, "test:unit", "test:e2e"];
  expect(requiredCommands(split)).toEqual(steps);
  const splitDeclaration = declarationFor(split, "main");
  const tiered = full.replace("      - run: bun run test\n", "      - run: bun run test:unit\n      - run: bun run test:e2e\n");
  expect(findGaps(splitDeclaration, workflow(tiered))).toEqual([]);
  expect(findGaps(splitDeclaration, workflow(full))).toEqual([]);
  const unitOnly = full.replace("      - run: bun run test\n", "      - run: bun run test:unit\n");
  expect(findGaps(splitDeclaration, workflow(unitOnly)).map(({ gate }) => gate)).toEqual(["bun run test"]);
  const disabled = tiered.replace("      - run: bun run test:e2e\n", "      - run: bun run test:e2e\n        if: false\n");
  expect(findGaps(splitDeclaration, workflow(disabled))).toEqual([
    { gate: "bun run test", blocked: [{ location: ".github/workflows/ci.yml job checks step 6", blocker: "the step sets if: false" }] },
  ]);
  expect(findGaps(declarationFor([...scripts, "test:unit"], "main"), workflow(tiered)).map(({ gate }) => gate)).toEqual(["bun run test"]);
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

test("only a command's program marks a mutation job, wherever the shell runs that command", () => {
  const mutating = new Map([["mutate", 'out="$(bunx stryker run)"']]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: mutating },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ['output="$(bunx stryker run)"', 'echo "`checks-mutation`"', "bun run mutate", ">log.txt 2>&1 checks-mutation a b", "if bunx stryker run; then echo ok; fi"]) {
    expect(sweep(run)[0]?.fault).toContain(WINBOX);
  }
  for (const run of ["echo 'checks-mutation'", "bun run lint > checks-mutation.log", "echo stryker run"]) {
    expect(sweep(run)).toEqual([]);
  }
});

test("bracket access or any case of CI_RUNS_ON still reads the override", () => {
  for (const override of ["${{ vars['CI_RUNS_ON'] || 'ubuntu-latest' }}", "${{ VARS.ci_runs_on || 'ubuntu-latest' }}"]) {
    for (const visibility of ["public", "unknown"] as const) {
      expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(override, "ubuntu-latest"))[0]?.fault).toContain("reads CI_RUNS_ON");
      expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(WINBOX, override.replace("'ubuntu-latest'", "fromJSON('[\"self-hosted\"]')")))).toHaveLength(1);
    }
  }
});

test("bun reaches a package script with or without run and past its own options", () => {
  const mutating = new Map([["mutate", "bunx stryker run"], ["test", "bunx stryker run"]]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: mutating },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ["bun mutate", "bun --cwd . run mutate", "bun run --cwd . mutate", "bun --cwd . x stryker run", "env -u HOME bun run mutate", "bun run test"]) {
    expect(sweep(run)[0]?.fault).toContain(WINBOX);
  }
  for (const run of ["bun test", "bun --cwd mutate run lint", "sudo -u stryker run-parts"]) {
    expect(sweep(run)).toEqual([]);
  }
});

test("the hosted default matches the override in any form the override check accepts, and only ubuntu-latest", () => {
  for (const visibility of ["private", "public", "unknown"] as const) {
    for (const hosted of ["${{ vars['CI_RUNS_ON'] || 'ubuntu-latest' }}", "${{ VARS.ci_runs_on||'ubuntu-latest' }}"]) {
      expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(WINBOX, hosted))).toEqual([]);
    }
    expect(findRunnerFaults({ visibility, scripts: noScripts }, jobs(WINBOX, "${{ vars.CI_RUNS_ON || 'ubuntu -latest' }}"))).toHaveLength(1);
  }
});

test("the runner report names each job and what to set", () => {
  const faults = findRunnerFaults({ visibility: "private", scripts: noScripts }, jobs("ubuntu-latest", HOSTED));
  expect(formatRunnerReport(faults)).toBe(
    `ci-wiring: 1 job(s) run on the wrong runner:\n  .github/workflows/ci.yml job mutation: ${faults[0]?.fault}`,
  );
});

test("a package script through a repository file to stryker is a mutation job pinned to winbox", () => {
  const wired = new Map([["mutate:incremental", "scripts/mutate.sh --incremental"]]);
  const files = new Map([
    ["scripts/mutate.sh", 'exec ./node_modules/.bin/stryker run "$@"'],
    ["mutate.sh", "scripts/mutate.sh"],
  ]);
  const sweep = (run: string, runsOn: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: wired, files },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${runsOn}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  const runs = ["time bun run mutate:incremental", "scripts/mutate.sh --incremental", "./scripts/mutate.sh --incremental", "./mutate.sh", "bun run ./scripts/mutate.sh", "bun scripts/mutate.sh", "bun mutate.sh"];
  for (const run of runs) {
    expect(sweep(run, HOSTED)[0]?.fault).toContain(WINBOX);
    expect(sweep(run, WINBOX)).toEqual([]);
  }
  expect(sweep("mutate.sh", HOSTED)).toEqual([]);
});

test("a repository file without a mutation call stays a hosted job", () => {
  const wired = new Map([["generate", "scripts/generate.sh"]]);
  const files = new Map([["scripts/generate.sh", "echo done"]]);
  const sweep = (run: string) =>
    findRunnerFaults(
      { visibility: "private", scripts: wired, files },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`),
    );
  for (const run of ["bun run generate", "scripts/generate.sh", "./scripts/generate.sh"]) {
    expect(sweep(run)).toEqual([]);
  }
  expect(
    findRunnerFaults(
      { visibility: "private", scripts: wired, files },
      workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${WINBOX}\n    steps:\n      - run: "bun run generate"\n`),
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
      { visibility: "private", scripts: wired, files },
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
    findRunnerFaults({ visibility: "private", scripts: wired, files }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${runsOn}\n    steps:\n      - run: bun run scripts/mutate.sh\n`));
  expect(sweep(HOSTED)[0]?.fault).toContain(WINBOX);
  expect(sweep(WINBOX)).toEqual([]);
});

test("a here-document's text is data, and only an unquoted one's substitutions run", () => {
  const files = new Map([
    ["scripts/help.sh", "cat <<'EOF'\nbunx stryker run\nEOF\n"],
    ["scripts/tabbed.sh", "cat <<-EOF >&2\n\tbunx stryker run\n\tEOF\necho done\n"],
    ["scripts/expanded.sh", "cat <<EOF\nsummary: $(bunx stryker run)\nEOF\n"],
    ["scripts/after.sh", "cat <<\"EOF\"\nusage\nEOF\nbunx stryker run\n"],
  ]);
  const sweep = (run: string) =>
    findRunnerFaults({ visibility: "private", scripts: new Map(), files }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${run}\n`));
  expect(sweep("scripts/help.sh")).toEqual([]);
  expect(sweep("scripts/tabbed.sh")).toEqual([]);
  expect(sweep("scripts/expanded.sh")[0]?.fault).toContain(WINBOX);
  expect(sweep("scripts/after.sh")[0]?.fault).toContain(WINBOX);
  expect(sweep("cat <<< 'bunx stryker run'")).toEqual([]);
});

test("a here-document a shell reads is its script, quoted or not", () => {
  const sweep = (run: string) =>
    findRunnerFaults({ visibility: "private", scripts: new Map() }, workflow(`on: pull_request\njobs:\n  sweep:\n    runs-on: ${HOSTED}\n    steps:\n      - run: ${JSON.stringify(run)}\n`));
  for (const delimiter of ["'EOF'", "EOF"]) {
    expect(sweep(`bash <<${delimiter}\nset -e\nbunx stryker run\nEOF\n`)[0]?.fault).toContain(WINBOX);
    expect(sweep(`/bin/sh -s <<-${delimiter} >&2\n\tbunx stryker run\n\tEOF\n`)[0]?.fault).toContain(WINBOX);
  }
  expect(sweep("cat <<'EOF'\nbunx stryker run\nEOF\n")).toEqual([]);
});

test("a repository file resolves from the directory its command runs in", () => {
  const files = new Map([
    ["mutate.sh", "echo report"],
    ["tools/mutate.sh", "bunx stryker run"],
    ["tools/report.sh", "./mutate.sh"],
  ]);
  const sweep = (job: string, defaults = "") =>
    findRunnerFaults({ visibility: "private", scripts: new Map(), files }, workflow(`on: pull_request\n${defaults}jobs:\n  sweep:\n    runs-on: ${HOSTED}\n${job}`));
  const step = (run: string, extra = "") => `    steps:\n      - run: ${JSON.stringify(run)}\n${extra}`;
  const tools = "        working-directory: tools\n";
  const mutation = (job: string, defaults?: string) => expect(sweep(job, defaults)[0]?.fault).toContain(WINBOX);
  expect(sweep(step("./mutate.sh"))).toEqual([]);
  mutation(step("./mutate.sh", tools));
  mutation(step("../tools/mutate.sh", "        working-directory: ./docs\n"));
  mutation(`    defaults:\n      run:\n        working-directory: tools\n${step("./mutate.sh")}`);
  mutation(step("./mutate.sh"), "defaults:\n  run:\n    working-directory: tools\n");
  expect(sweep(step("./mutate.sh", "        working-directory: .\n"), "defaults:\n  run:\n    working-directory: tools\n")).toEqual([]);
  mutation(step("cd tools && ./mutate.sh"));
  expect(sweep(step("cd tools; cd ..; ./mutate.sh"))).toEqual([]);
  mutation(step("bun --cwd=tools run ./mutate.sh"));
  mutation(step("./report.sh", tools));
  expect(sweep(step("bun --cwd=tools run ../mutate.sh"))).toEqual([]);
  expect(sweep(step("./mutate.sh", "        working-directory: ${{ github.workspace }}/tools\n"))).toEqual([]);
});

function named(files: Readonly<Record<string, string>>) {
  return Object.entries(files).map(([name, text]) => Effect.runSync(parseWorkflow(`.github/workflows/${name}`, text)));
}

const held = "name: CI\non: push\njobs:\n  checks:\n    runs-on: ubuntu-latest\n";

test("a checks-release-pr argument must name a workflow the repository holds", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(release("bunx checks-release-pr ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(release("bun src/delivery/release-pr.ts ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(release("./node_modules/.bin/checks-release-pr ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(release("echo checks-release-pr commitlint.yml"))).toEqual([]);
  expect(findMissingWorkflows(release("bunx checks-release-pr archive/ci.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow archive/ci.yml" },
  ]);
  expect(findMissingWorkflows(release("bunx checks-release-pr ci.yml commitlint")).map(({ fault }) => fault)).toEqual([
    "names missing workflow commitlint",
  ]);
  expect(findMissingWorkflows(release("bunx checks-release-pr ci.yml -removed.yml")).map(({ fault }) => fault)).toEqual([
    "names missing workflow -removed.yml",
  ]);
  const missing = findMissingWorkflows(release("bunx checks-release-pr ci.yml commitlint.yml"));
  expect(missing).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow commitlint.yml" },
  ]);
  expect(formatMissingReport(missing)).toBe(
    "ci-wiring: 1 reference(s) name a missing workflow or job:\n  .github/workflows/daily-release.yml line 8: names missing workflow commitlint.yml",
  );
});

test("a checks-release-tag argument must name a workflow the repository holds", () => {
  const tag = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  push:\njobs:\n  tag:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(tag("bunx checks-release-tag ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(tag("echo checks-release-tag release.yml"))).toEqual([]);
  expect(findMissingWorkflows(tag("bunx checks-release-tag release.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow release.yml" },
  ]);
  expect(findMissingWorkflows(tag("bun src/delivery/release-tag.ts release.yml")).map(({ fault }) => fault)).toEqual([
    "names missing workflow release.yml",
  ]);
});

test("a bun run release call names a workflow the repository holds", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(release("bun run ./node_modules/.bin/checks-release-pr ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(release("bun run ./node_modules/.bin/checks-release-pr gone.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow gone.yml" },
  ]);
  expect(findMissingWorkflows(release("bun run src/delivery/release-pr.ts gone.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow gone.yml" },
  ]);
  expect(findMissingWorkflows(release("bun run ./node_modules/.bin/checks-release-tag release.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow release.yml" },
  ]);
  expect(findMissingWorkflows(release("bun run src/delivery/release-tag.ts release.yml"))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow release.yml" },
  ]);
});

test("a release target the shell or GitHub fills in at run time is not judged", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(release('WORKFLOW=ci.yml bunx checks-release-pr "$WORKFLOW"'))).toEqual([]);
  expect(findMissingWorkflows(release("bunx checks-release-tag ${{ inputs.workflow }}"))).toEqual([]);
  expect(findMissingWorkflows(release("bunx checks-release-pr ci.yml-${{ inputs.suffix }}"))).toEqual([]);
  expect(findMissingWorkflows(release("bunx checks-release-pr ${{ inputs.workflow }} gone.yml")).map(({ fault }) => fault)).toEqual([
    "names missing workflow gone.yml",
  ]);
});

test("a release target built by command substitution is not judged", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(release('bunx checks-release-pr "$(printf ci.yml)"'))).toEqual([]);
  expect(findMissingWorkflows(release('bunx checks-release-tag "$(printf release.yml)"'))).toEqual([]);
});

test("an explicitly empty release target is refused", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  expect(findMissingWorkflows(release('bunx checks-release-pr ""'))).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow " },
  ]);
});

test("a workflow_run entry must name a workflow in the repository", () => {
  const nightly = (watched: string) =>
    named({
      "ci.yml": held,
      "nightly.yml": `name: nightly\non:\n  workflow_run:\n    workflows: [${watched}]\n    types: [completed]\njobs:\n  report:\n    runs-on: ubuntu-latest\n`,
    });
  expect(findMissingWorkflows(nightly("CI"))).toEqual([]);
  expect(findMissingWorkflows(nightly("CI, lint")).map(({ fault }) => fault)).toEqual(["names missing workflow lint"]);
  const unnamed = (watched: string) =>
    named({
      "ci.yml": "on: push\njobs:\n  checks:\n    runs-on: ubuntu-latest\n",
      "nightly.yml": `name: nightly\non:\n  workflow_run:\n    workflows: [${watched}]\n    types: [completed]\njobs:\n  report:\n    runs-on: ubuntu-latest\n`,
    });
  expect(findMissingWorkflows(unnamed(".github/workflows/ci.yml"))).toEqual([]);
  expect(findMissingWorkflows(unnamed("ci.yml")).map(({ fault }) => fault)).toEqual(["names missing workflow ci.yml"]);
});

test("a local reusable workflow must name a file the repository holds", () => {
  const caller = "name: caller\non: push\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/workflows/action.yml\n";
  expect(findMissingWorkflows(named({ "ci.yml": held, "caller.yml": caller }))).toEqual([
    { location: ".github/workflows/caller.yml line 5", fault: "names missing workflow .github/workflows/reusable.yml" },
    { location: ".github/workflows/caller.yml line 9", fault: "names missing workflow .github/workflows/action.yml" },
  ]);
  const kept = { "ci.yml": held, "caller.yml": caller, "reusable.yml": held, "action.yml": held };
  expect(findMissingWorkflows(named(kept))).toEqual([]);
});

test("a refusal names the reference line rather than an earlier substring", () => {
  const scoped = named({
    "ci.yml": held,
    "pipe.yml":
      "name: unit-test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n  check:\n    needs: [build, test]\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n",
  });
  expect(findMissingWorkflows(scoped)).toEqual([
    { location: ".github/workflows/pipe.yml line 9", fault: "job check needs missing job test" },
  ]);
});

test("a refusal names the field that holds the reference, not a name above it", () => {
  const report = named({
    "ci.yml": held,
    "pipe.yml":
      "name: pipe\non: push\njobs:\n  report:\n    name: integration-test\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - name: checks-release-pr gone.yml\n        run: |\n          echo start\n          bunx checks-release-pr gone.yml\n",
  });
  expect(findMissingWorkflows(report)).toEqual([
    { location: ".github/workflows/pipe.yml line 6", fault: "job report needs missing job test" },
    { location: ".github/workflows/pipe.yml line 12", fault: "names missing workflow gone.yml" },
  ]);
});

test("repeated targets each name their own line", () => {
  const twice = named({
    "ci.yml": held,
    "daily-release.yml":
      "name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bunx checks-release-pr gone.yml\n      - run: bunx checks-release-pr gone.yml\n",
  });
  expect(findMissingWorkflows(twice)).toEqual([
    { location: ".github/workflows/daily-release.yml line 8", fault: "names missing workflow gone.yml" },
    { location: ".github/workflows/daily-release.yml line 9", fault: "names missing workflow gone.yml" },
  ]);
});

test("a refusal names the invocation line rather than an earlier echo or comment", () => {
  const pipe = (first: string, call: string) =>
    named({
      "ci.yml": held,
      "pipe.yml": `name: pipe\non: push\njobs:\n  report:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          ${first}\n          ${call}\n`,
    });
  const refusal = { location: ".github/workflows/pipe.yml line 9", fault: "names missing workflow gone.yml" };
  const releases = ["bunx checks-release-pr", "bunx checks-release-tag", "bun run src/delivery/release-pr.ts", "bun run ./node_modules/.bin/checks-release-tag"];
  for (const release of releases) {
    for (const first of ["echo gone.yml", "# gone.yml", `echo '${release} gone.yml'`, `# ${release} gone.yml`]) {
      expect(findMissingWorkflows(pipe(first, `${release} gone.yml`))).toEqual([refusal]);
    }
    expect(findMissingWorkflows(pipe(`# ${release} gone.yml`, `${release} gone.yml gone.yml`))).toEqual([refusal, refusal]);
  }
});

test("a refusal names the physical line of the call in each scalar style", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
  const at = (line: number) => [{ location: `.github/workflows/daily-release.yml line ${line}`, fault: "names missing workflow gone.yml" }];
  expect(findMissingWorkflows(release("|-\n          bunx checks-release-pr gone.yml"))).toEqual(at(9));
  expect(findMissingWorkflows(release('"echo gone.yml\\nbunx checks-release-pr gone.yml"'))).toEqual(at(8));
  expect(findMissingWorkflows(release("'echo gone.yml; bun run src/delivery/release-tag.ts gone.yml'"))).toEqual(at(8));
  expect(findMissingWorkflows(release(">\n          echo gone.yml\n\n          bunx checks-release-tag gone.yml"))).toEqual(at(11));
});

test("a refusal inside a heredoc or substitution names the line of the call", () => {
  const release = (run: string) =>
    named({
      "ci.yml": held,
      "daily-release.yml": `name: daily-release\non:\n  workflow_dispatch:\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo gone.yml\n${run}`,
    });
  const at = (line: number) => [{ location: `.github/workflows/daily-release.yml line ${line}`, fault: "names missing workflow gone.yml" }];
  expect(findMissingWorkflows(release("          bash <<'EOF'\n          bunx checks-release-pr gone.yml\n          EOF\n"))).toEqual(at(11));
  expect(findMissingWorkflows(release('          echo "$(bun run src/delivery/release-pr.ts gone.yml)"\n'))).toEqual(at(10));
});

test("a needs entry must name a job in the same workflow", () => {
  const pipe = named({
    "ci.yml": held,
    "pipe.yml":
      "name: pipe\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n  test:\n    needs: [build, checks]\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n",
  });
  expect(findMissingWorkflows(pipe)).toEqual([
    { location: ".github/workflows/pipe.yml line 9", fault: "job test needs missing job checks" },
  ]);
});
