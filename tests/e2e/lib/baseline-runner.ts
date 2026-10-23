import { $ } from "bun";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeActions, type FakeOptions, type FakeRun } from "./fake-actions.ts";
import { CHECKOUT, ran, type Ran, scratchDirs } from "./fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "testing", "mutation-baseline.ts");
const REPOSITORY_ID = 4242;
export const SHELVES = join(".cache", "avi2dg-checks", "mutation-baseline", String(REPOSITORY_ID));

const scratch = scratchDirs();

export type Runner = {
  readonly home: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string | undefined>>) => Promise<Ran>;
  readonly downloads: () => Promise<readonly string[]>;
  readonly calls: () => Promise<readonly string[]>;
  readonly read: (file: string) => Promise<string | undefined>;
  readonly shelf: (artifact: string) => Promise<readonly string[]>;
};

export function baseline(id: number, name: string, tag: string, expired = false): FakeRun["artifacts"][number] {
  return { id, name, expired, files: { "stryker-incremental.json": `{"state":"${tag}"}`, "mutation/mutation.json": `{"report":"${tag}"}` } };
}

// A full artifact uploaded from the one path reports/mutation/mutation.json holds the report at its root and no state beside it.
export function fullReport(id: number, tag: string): FakeRun["artifacts"][number] {
  return { id, name: "mutation-baseline-full", expired: false, files: { "mutation.json": `{"report":"${tag}"}` } };
}

// A full artifact uploaded from both baseline paths holds the report under mutation/ with the incremental state beside it.
export function fullBaseline(id: number, tag: string): FakeRun["artifacts"][number] {
  return {
    id,
    name: "mutation-baseline-full",
    expired: false,
    files: { "mutation/mutation.json": `{"report":"${tag}"}`, "stryker-incremental.json": `{"state":"${tag}"}` },
  };
}

export function run(databaseId: number, event: string, createdAt: string, artifacts: FakeRun["artifacts"], headSha?: string): FakeRun {
  return { databaseId, event, createdAt, ...(headSha === undefined ? {} : { headSha }), artifacts };
}

export async function gitRunner(files: Readonly<Record<string, string>>, build: (sha: string) => readonly FakeRun[]): Promise<Runner & { readonly work: string }> {
  const home = await scratch("checks-mutation-baseline-git-");
  const work = join(home, "work");
  await mkdir(work);
  await $`git init -q -b main && git config user.email fixture@example.com && git config user.name Fixture`.cwd(work).quiet();
  await writeFile(join(work, "tracked.txt"), "base\n");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(work, name.slice(0, Math.max(name.lastIndexOf("/"), 0))), { recursive: true });
    await writeFile(join(work, name), content);
  }
  await $`git add -A && git commit -qm base`.cwd(work).quiet();
  const sha = (await $`git rev-parse HEAD`.cwd(work).quiet()).stdout.toString().trim();
  const fake = await fakeActions(home, REPOSITORY_ID, build(sha));
  return {
    home,
    work,
    run: (args, env = {}) =>
      ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, RUNNER_ENVIRONMENT: "self-hosted", GITHUB_RUN_ID: undefined, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), ...fake.env, HOME: home, ...env })),
    downloads: fake.downloads,
    calls: fake.calls,
    read: (file) => readFile(join(work, file), "utf8").catch(() => undefined),
    shelf: async (artifact) => (await readdir(join(home, SHELVES, artifact)).catch(() => [])).filter((entry) => !entry.startsWith(".")).sort(),
  };
}

// HOME holds the runner's cache, so each runner starts with an empty one.
export async function selfHosted(runs: readonly FakeRun[], options: FakeOptions = {}): Promise<Runner> {
  const home = await scratch("checks-mutation-baseline-");
  const fake = await fakeActions(home, REPOSITORY_ID, runs, options);
  const work = join(home, "work");
  await mkdir(work);
  return {
    home,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(work).env({ ...process.env, RUNNER_ENVIRONMENT: "self-hosted", GITHUB_RUN_ID: undefined, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID), ...fake.env, HOME: home, ...env })),
    downloads: fake.downloads,
    calls: fake.calls,
    read: (file) => readFile(join(work, file), "utf8").catch(() => undefined),
    shelf: async (artifact) => (await readdir(join(home, SHELVES, artifact)).catch(() => [])).filter((entry) => !entry.startsWith(".")).sort(),
  };
}

export const MAIN_RUNS = [
  run(30, "pull_request", "2026-10-03T00:00:00Z", [baseline(300, "mutation-baseline", "pull request")]),
  run(20, "push", "2026-10-02T00:00:00Z", [baseline(200, "mutation-baseline", "newest push")]),
  run(10, "push", "2026-10-01T00:00:00Z", [baseline(100, "mutation-baseline", "older push")]),
];

export const SAVED_SHELF = join(SHELVES, "saved", "mutation-baseline");

export async function savedEntry(runner: Runner, runId: number, files: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(join(runner.home, SAVED_SHELF), { recursive: true });
  await writeFile(join(runner.home, SAVED_SHELF, `${runId}.json`), JSON.stringify(files));
}
