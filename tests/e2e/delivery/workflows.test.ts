import { $ } from "bun";
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const SITE = { pages: "acme", domain: "acme.example", production: "acme/acme.example" };

const open = fixtureRepos("checks-workflows-");

const manifest = (extra: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" }, ...extra });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const held = async (repo: FixtureRepo): Promise<readonly string[]> => (await readdir(join(repo.dir, ".github", "workflows"))).sort();

const parsed = async (repo: FixtureRepo, name: string): Promise<unknown> => Bun.YAML.parse(await readFile(join(repo.dir, ".github", "workflows", name), "utf8"));

test("a code repository without workflow files is refused until --write writes ci, pr-title, main and release, which ci-wiring then accepts", async () => {
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");

  const missing = await workflows(repo);
  expect(missing.exitCode).toBe(1);
  for (const name of ["ci.yml", "pr-title.yml", "main.yml", "release.yml"]) expect(missing.text).toContain(`  .github/workflows/${name}: missing\n`);

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set\n" });
  expect(await held(repo)).toEqual(["ci.yml", "main.yml", "pr-title.yml", "release.yml"]);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    on: { pull_request: { types: ["opened", "synchronize", "reopened"] }, workflow_dispatch: null },
    concurrency: { "cancel-in-progress": true },
    jobs: { checks: { uses: "avi2d/workflows/.github/workflows/ci.yml@v3" } },
  });
  expect(await parsed(repo, "pr-title.yml")).toMatchObject({ on: { pull_request: { types: ["edited"] } } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ on: { push: { branches: ["main"] } }, jobs: { release: { uses: "avi2d/workflows/.github/workflows/release-main.yml@v3" } } });
  expect(await parsed(repo, "release.yml")).toMatchObject({ on: { workflow_dispatch: null }, jobs: { "pull-request": { uses: "avi2d/workflows/.github/workflows/release-pr.yml@v3" } } });

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
  await repo.commit("ci: write the workflow set");
  const wiring = await ran($`bun ${WIRING}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(wiring.text).toContain("ci-wiring: .github/workflows holds the set checks-workflows writes, so the shared workflows run every gate\n");
  expect(wiring.exitCode).toBe(0);
}, 30_000);

test("a site repository gets the six site callers, keeps advisories in its caller form, and loses the workflow files the set replaces", async () => {
  const repo = await open({
    "package.json": manifest({ site: SITE }),
    ".github/workflows/pages.yml": "name: pages\non: push\n",
    ".github/workflows/advisories.yml": "name: advisories\non:\n  schedule:\n    - cron: \"15 5 * * 1\"\n",
  });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/pages.yml: no workflow of the set, so delete it\n");
  expect(refused.text).toContain("  .github/workflows/advisories.yml: differs from the caller checks-workflows writes\n");
  expect(refused.text).toContain("  .github/workflows/production.yml: missing\n");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the site set, and deleted pages.yml\n" });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "main.yml", "pr-title.yml", "preview-close.yml", "production.yml", "release.yml"]);
  expect(await parsed(repo, "advisories.yml")).toEqual({
    name: "advisories",
    on: { workflow_dispatch: null },
    jobs: { advisories: { uses: "avi2d/workflows/.github/workflows/advisories.yml@v1", permissions: { contents: "read", issues: "write" } } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({ jobs: { checks: { uses: "avi2d/workflows/.github/workflows/site-ci.yml@v3", secrets: "inherit" } } });
  expect(await parsed(repo, "preview-close.yml")).toMatchObject({ on: { pull_request: { types: ["closed"] } } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ jobs: { release: { uses: "avi2d/workflows/.github/workflows/site-main.yml@v3" } } });
  expect(await parsed(repo, "production.yml")).toMatchObject({ on: { workflow_dispatch: null }, jobs: { production: { uses: "avi2d/workflows/.github/workflows/site-production.yml@v3" } } });
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("an edited line in a written caller is refused with the line it holds and the line the caller holds", async () => {
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");
  await workflows(repo, ["--write"]);
  const ci = join(repo.dir, ".github", "workflows", "ci.yml");
  await Bun.write(ci, (await readFile(ci, "utf8")).replace("cancel-in-progress: true", "cancel-in-progress: false"));

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain(
    [
      "workflows: .github/workflows differs from the code set in 1 file(s):",
      "  .github/workflows/ci.yml: differs from the caller checks-workflows writes",
      '    line 10: holds "  cancel-in-progress: false", the caller holds "  cancel-in-progress: true"',
      "  run checks-workflows --write to write the set",
    ].join("\n"),
  );
}, 30_000);

test("the shared workflow repository keeps its own files and an unknown flag is refused", async () => {
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": "name: ci\n" });
  await repo.commit("start");

  const shared = await ran($`bun ${SCRIPT}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "avi2d/workflows" }));
  expect(shared).toEqual({ exitCode: 0, text: "workflows: this repository holds the shared workflows, so it keeps its own workflow files\n" });

  const flagged = await workflows(repo, ["--force"]);
  expect(flagged.exitCode).toBe(2);
  expect(flagged.text).toContain("usage: workflows.ts [--write]");
}, 30_000);
