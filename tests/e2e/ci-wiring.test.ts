import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "ci-wiring.ts");
const LINT_COVERAGE = join(CHECKOUT, "scripts", "lint-coverage.sh");
const METADATA_GATES = ["checks-commit-identity", "checks-comment-gate", "checks-suppressions-ratchet", "checks-ci-wiring"];
const SOURCE_FREE_GATES = [...METADATA_GATES, "checks-quality"];

const WORKFLOW = `on:
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run test
`;

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function initRepo(quality: unknown, workflow: string): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-ci-wiring-"));
  await writeFile(join(dir, "quality.json"), JSON.stringify(quality));
  await writeWorkflow(workflow);
  await $`git init -q -b main`.cwd(dir).quiet();
}

async function writeWorkflow(workflow: string): Promise<void> {
  await mkdir(join(dir, ".github", "workflows"), { recursive: true });
  await writeFile(join(dir, ".github", "workflows", "ci.yml"), workflow);
}

async function check(cwd = dir): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT}`.cwd(cwd).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

test(
  "ci-wiring goes red when a declared gate's step is deleted and green once it is restored",
  async () => {
    await initRepo({ gates: { ci: ["bun run lint", "bun run test"] } }, WORKFLOW);

    const green = await check();
    expect(green.text).toContain("ci-wiring: 2 gate(s) run on pull requests to main");
    expect(green.exitCode).toBe(0);

    await writeWorkflow(WORKFLOW.replace("      - run: bun run lint\n", ""));
    const red = await check();
    expect(red.text).toContain("ci-wiring: 1 of 2 gate(s) do not run on pull requests to main:");
    expect(red.text).toContain("  bun run lint\n    no run step invokes it");
    expect(red.exitCode).toBe(1);

    await writeWorkflow(WORKFLOW);
    await mkdir(join(dir, "packages", "nested"), { recursive: true });
    const fromSubdirectory = await check(join(dir, "packages", "nested"));
    expect(fromSubdirectory.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a selection leaving out the source gates passes a source-free repository and is refused once it tracks source",
  async () => {
    await initRepo({ gates: { ci: ["bun run lint"], lint: METADATA_GATES } }, WORKFLOW);
    await $`git add -A`.cwd(dir).quiet();

    const withoutQuality = await check();
    expect(withoutQuality.text).toContain(
      [
        "ci-wiring: gates.lint leaves out 1 gate(s) this repository's contents make applicable:",
        "  checks-quality: the repository tracks a quality.json (quality.json)",
      ].join("\n"),
    );
    expect(withoutQuality.exitCode).toBe(1);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ gates: { ci: ["bun run lint"], lint: SOURCE_FREE_GATES } }));
    const sourceFree = await check();
    expect(sourceFree.text).toContain(
      "ci-wiring: gates.lint leaves out checks-lint-coverage, checks-test-layout, none of which this repository's contents make applicable",
    );
    expect(sourceFree.exitCode).toBe(0);

    await writeFile(join(dir, "widget.tsx"), "export const widget = 42;\n");
    const untracked = await check();
    expect(untracked.exitCode).toBe(0);

    await $`git add -A`.cwd(dir).quiet();
    const tracked = await check();
    expect(tracked.text).toContain(
      [
        "ci-wiring: gates.lint leaves out 2 gate(s) this repository's contents make applicable:",
        "  checks-lint-coverage: the repository tracks TypeScript source (widget.tsx)",
        "  checks-test-layout: the repository tracks TypeScript source (widget.tsx)",
      ].join("\n"),
    );
    expect(tracked.exitCode).toBe(1);
  },
  60_000,
);

test(
  "ci-wiring counts as TypeScript source exactly the files lint-coverage checks",
  async () => {
    await initRepo({ gates: { ci: ["bun run lint"], lint: SOURCE_FREE_GATES } }, WORKFLOW);
    await mkdir(join(dir, "src"));
    for (const file of ["a.ts", "b.tsx", "c.mts", "d.cts", "e.js", "f.ts.md"]) {
      await writeFile(join(dir, "src", file), "export const value = 1;\n");
    }
    await $`git add -A`.cwd(dir).quiet();

    const coverage = await $`${LINT_COVERAGE}`
      .cwd(dir)
      .env({ ...process.env, PATH: `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}` })
      .nothrow()
      .quiet();
    const checked = /^lint-coverage: (?:oxlint skips )?\d+\/(\d+) tracked/m.exec(coverage.stdout.toString());
    const refused = /^ {2}checks-lint-coverage: the repository tracks TypeScript source \(\S+ and (\d+) more\)$/m.exec(
      (await check()).text,
    );
    expect(checked).not.toBeNull();
    expect(refused).not.toBeNull();
    expect(Number(refused?.[1]) + 1).toBe(Number(checked?.[1]));
  },
  60_000,
);

test(
  "ci-wiring refuses to pass a repository that declares no gates",
  async () => {
    await initRepo({}, WORKFLOW);
    const result = await check();
    expect(result.text).toContain("quality.json declares no gates.ci, a non-empty array of commands");
    expect(result.exitCode).toBe(2);
  },
  60_000,
);

test(
  "ci-wiring goes red while a declared scheduled command has no scheduled workflow, and green once one runs it",
  async () => {
    await initRepo({ gates: { ci: ["bun run lint"], scheduled: ["bunx checks-flake --runs 20"] } }, WORKFLOW);
    const red = await check();
    expect(red.text).toContain("ci-wiring: 1 gate(s) run on pull requests to main");
    expect(red.text).toContain("ci-wiring: 1 of 1 scheduled command(s) do not run on a schedule:\n  bunx checks-flake --runs 20\n    no run step invokes it");
    expect(red.exitCode).toBe(1);

    await writeFile(
      join(dir, ".github", "workflows", "flake.yml"),
      'on:\n  schedule:\n    - cron: "0 5 * * *"\njobs:\n  flake:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bunx checks-flake --runs 20\n',
    );
    const green = await check();
    expect(green.text).toContain("ci-wiring: 1 scheduled command(s) run on a schedule");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
