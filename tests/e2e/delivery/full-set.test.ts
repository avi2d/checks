import { $ } from "bun";
import { expect, test } from "bun:test";
import { Schema } from "effect";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";
import { expectNoRemoteUses } from "../lib/local-uses.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const SITE_FLAGS = ["--pages", "acme", "--domain", "acme.example", "--production", "acme/acme.example"];
const open = fixtureRepos("checks-full-set-");

const manifest = JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" } });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const listed = async (repo: FixtureRepo, dir: string): Promise<readonly string[]> => (await readdir(join(repo.dir, dir), { recursive: true })).sort();

const text = (repo: FixtureRepo, path: string): Promise<string> => readFile(join(repo.dir, path), "utf8");

const parsed = async (repo: FixtureRepo, name: string): Promise<unknown> => Bun.YAML.parse(await text(repo, join(".github", "workflows", name)));

const decodeJobs = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Record(Schema.String, Schema.Unknown) }));
const Step = Schema.Struct({
  run: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  if: Schema.optionalKey(Schema.String),
  uses: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Struct({ path: Schema.optionalKey(Schema.String), key: Schema.optionalKey(Schema.String) })),
});
const decodeJob = Schema.decodeUnknownSync(Schema.Struct({ steps: Schema.Array(Step) }));

async function expectGitleaksBeforeTests(repo: FixtureRepo, file: string, job: string): Promise<void> {
  const { jobs } = decodeJobs(await parsed(repo, file));
  const { steps } = decodeJob(jobs[job]);
  const cache = steps.findIndex((step) => step.with?.path === "~/.cache/avi2dg-checks/gitleaks");
  const install = steps.findIndex((step) => step.run === "bunx checks-ci gitleaks");
  const tests = steps.findIndex((step) => step.id === "test" || step.run === "bun run test --full");
  expect(cache).toBeGreaterThanOrEqual(0);
  expect(steps[cache]?.uses?.startsWith("actions/cache@")).toBe(true);
  expect(install).toBeGreaterThan(cache);
  expect(tests).toBeGreaterThan(install);
}

test("a code write that leaves a job calling another repository's workflow, or a gate job that branch protection reads as checks / checks, fails", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await listed(repo, ".github/workflows")).toEqual(["ci.yml", "main.yml", "mutation.yml", "pr-text.yml", "pr-title.yml", "release.yml", "whole-tree-run.yml"]);
  expect(await listed(repo, ".github/actions")).toEqual(["setup", "setup/action.yml", "setup/bun-without-unzip.sh"]);
  for (const name of await listed(repo, ".github/workflows")) expectNoRemoteUses(name, await text(repo, join(".github", "workflows", name)));
  expect(await parsed(repo, "ci.yml")).toMatchObject({ jobs: { checks: { needs: ["changes", "static", "unit"], if: "always()" } } });
  expect(await parsed(repo, "ci.yml")).not.toMatchObject({ jobs: { checks: { uses: expect.anything() } } });
  expect(await parsed(repo, "pr-title.yml")).toMatchObject({ on: { pull_request: { types: ["opened", "synchronize", "reopened", "edited"] } } });

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test.each([
  { kind: "code", flags: [] },
  { kind: "site", flags: SITE_FLAGS },
])("the $kind e2e job does not use a different gitleaks cache from static or provision it after tests", async ({ flags }) => {
  const repo = await open({ "package.json": manifest, "tests/e2e/scan.test.ts": "export {};\n" });
  await repo.commit("start");
  expect((await workflows(repo, ["--write", ...flags])).exitCode).toBe(0);
  await expectGitleaksBeforeTests(repo, "ci.yml", "e2e");
  const { jobs } = decodeJobs(await parsed(repo, "ci.yml"));
  const cache = (job: string) => decodeJob(jobs[job]).steps.filter((step) => step.with?.path === "~/.cache/avi2dg-checks/gitleaks");
  const staticCache = cache("static");
  expect(staticCache).toHaveLength(1);
  expect(staticCache[0]?.with?.key).toBe("gitleaks-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('node_modules/@avi2dg/checks/src/delivery/gitleaks.ts') }}");
  expect(cache("e2e")).toEqual(staticCache);
}, 30_000);

test.each<{ kind: string; files: Readonly<Record<string, string>> }>([
  { kind: "public package", files: { "package.json": manifest } },
  { kind: "private package with tests", files: { "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "bun test" } }) } },
  {
    kind: "public workspace",
    files: {
      "package.json": JSON.stringify({ name: "acme", private: true, workspaces: ["packages/*"] }),
      "packages/run/package.json": JSON.stringify({ name: "@acme/run", version: "1.0.0" }),
    },
  },
])("the $kind release suite does not run tests before it provisions the pinned gitleaks", async ({ files }) => {
  const repo = await open(files);
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  await expectGitleaksBeforeTests(repo, "main.yml", "suite");
}, 30_000);

test("site production does not test the staged release before it provisions the pinned gitleaks", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");
  expect((await workflows(repo, ["--write", ...SITE_FLAGS])).exitCode).toBe(0);
  await expectGitleaksBeforeTests(repo, "production.yml", "production");
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

  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({ exitCode: 0, text: "workflows: wrote the 9 workflow file(s) of the site set and its 3 action file(s)\n" });
  expect(await listed(repo, ".github/workflows")).toEqual(["ci.yml", "main.yml", "mutation.yml", "pr-text.yml", "pr-title.yml", "preview-close.yml", "production.yml", "release.yml", "whole-tree-run.yml"]);
  expect(await listed(repo, ".github/actions")).toContain("playwright/action.yml");
  for (const name of await listed(repo, ".github/workflows")) expectNoRemoteUses(name, await text(repo, join(".github", "workflows", name)));
  expect(await parsed(repo, "production.yml")).toMatchObject({ env: { SITE_PAGES: "acme", SITE_DOMAIN: "acme.example", SITE_PRODUCTION: "acme/acme.example" } });

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });
}, 30_000);

test("an unknown --full flag is refused instead of writing the set", async () => {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");
  expect((await workflows(repo, ["--write", "--full"])).exitCode).toBe(2);
  expect(await listed(repo, ".")).not.toContain(".github");
}, 30_000);
