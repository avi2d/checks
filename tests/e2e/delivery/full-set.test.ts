import { $ } from "bun";
import { expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const SITE_FLAGS = ["--pages", "acme", "--domain", "acme.example", "--production", "acme/acme.example"];
const REMOTE_CALL = /uses: [\w.-]+\/[\w.-]+\/\.github\/workflows\//;

const open = fixtureRepos("checks-full-set-");

const manifest = JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" } });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const listed = async (repo: FixtureRepo, dir: string): Promise<readonly string[]> => (await readdir(join(repo.dir, dir), { recursive: true })).sort();

const text = (repo: FixtureRepo, path: string): Promise<string> => readFile(join(repo.dir, path), "utf8");

const parsed = async (repo: FixtureRepo, name: string): Promise<unknown> => Bun.YAML.parse(await text(repo, join(".github", "workflows", name)));

test("a code write that leaves a job calling another repository's workflow, or a gate job that branch protection reads as checks / checks, fails", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await listed(repo, ".github/workflows")).toEqual(["ci.yml", "main.yml", "pr-title.yml", "release.yml"]);
  expect(await listed(repo, ".github/actions")).toEqual(["setup", "setup/action.yml", "setup/bun-without-unzip.sh"]);
  for (const name of await listed(repo, ".github/workflows")) expect(await text(repo, join(".github", "workflows", name))).not.toMatch(REMOTE_CALL);
  expect(await parsed(repo, "ci.yml")).toMatchObject({ jobs: { checks: { needs: ["changes", "static", "test"], if: "always()" } } });
  expect(await parsed(repo, "ci.yml")).not.toMatchObject({ jobs: { checks: { uses: expect.anything() } } });
  expect(await parsed(repo, "pr-title.yml")).toMatchObject({ on: { pull_request: { types: ["opened", "synchronize", "reopened", "edited"] } } });

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("an edited setup action that passes the check, or that --write leaves edited, fails", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");
  await workflows(repo, ["--write"]);

  const action = join(repo.dir, ".github", "actions", "setup", "action.yml");
  const written = await readFile(action, "utf8");
  await writeFile(action, `${written}# edited\n`);
  const edited = await workflows(repo);
  expect(edited.exitCode).toBe(1);
  expect(edited.text).toContain("workflows: .github/workflows differs from the code set in 1 file(s):\n");
  expect(edited.text).toContain("  .github/actions/setup/action.yml: differs from the file checks-workflows writes\n");
  expect(edited.text).toContain("  run checks-workflows --write to write the set\n");

  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await readFile(action, "utf8")).toBe(written);
}, 30_000);

test("a site write that drops the playwright action, the site workflows or the site names from the workflow env fails", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");

  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({ exitCode: 0, text: "workflows: wrote the 6 workflow file(s) of the site set and its 3 action file(s)\n" });
  expect(await listed(repo, ".github/workflows")).toEqual(["ci.yml", "main.yml", "pr-title.yml", "preview-close.yml", "production.yml", "release.yml"]);
  expect(await listed(repo, ".github/actions")).toContain("playwright/action.yml");
  for (const name of await listed(repo, ".github/workflows")) expect(await text(repo, join(".github", "workflows", name))).not.toMatch(REMOTE_CALL);
  expect(await parsed(repo, "production.yml")).toMatchObject({ env: { SITE_PAGES: "acme", SITE_DOMAIN: "acme.example", SITE_PRODUCTION: "acme/acme.example" } });

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });
}, 30_000);

test("an unknown --full flag is refused instead of writing the set", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");
  expect((await workflows(repo, ["--write", "--full"])).exitCode).toBe(2);
  expect(await listed(repo, ".")).not.toContain(".github");
}, 30_000);
