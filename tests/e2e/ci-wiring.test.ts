import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "..", "scripts", "ci-wiring.ts");

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

async function initRepo(manifest: unknown, workflow: string): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-ci-wiring-"));
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
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
    await initRepo({ name: "ci-wiring-fixture", ciWiring: { gates: ["bun run lint", "bun run test"] } }, WORKFLOW);

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
  "ci-wiring refuses to pass a repository that declares no gates",
  async () => {
    await initRepo({ name: "ci-wiring-fixture" }, WORKFLOW);
    const result = await check();
    expect(result.text).toContain("sets no ciWiring.gates");
    expect(result.exitCode).toBe(2);
  },
  60_000,
);
