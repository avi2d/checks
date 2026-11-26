import { $ } from "bun";
import { expect, test } from "bun:test";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";
import { expectNoRemoteUses } from "../lib/local-uses.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const PLAIN_STEPS = join(CHECKOUT, "src", "delivery", "plain-steps.ts");
const SITE = { pages: "acme", domain: "acme.example", production: "acme/acme.example" };
const FLEET_BUN_VERSION = (await readFile(join(CHECKOUT, ".bun-version"), "utf8")).trim();
const RELEASE_WITHOUT_VERSION = join(CHECKOUT, "tests", "fixtures", "workflows", "release-without-version.yml");
const open = fixtureRepos("checks-workflows-");

const manifest = (extra: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" }, ...extra });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const held = async (repo: FixtureRepo): Promise<readonly string[]> => (await readdir(join(repo.dir, ".github", "workflows"))).sort();

const text = async (repo: FixtureRepo, name: string): Promise<string> => readFile(join(repo.dir, ".github", "workflows", name), "utf8");

const parsed = async (repo: FixtureRepo, name: string): Promise<unknown> => Bun.YAML.parse(await text(repo, name));

const jobsOf = (workflow: unknown, file: string): object => {
  if (typeof workflow !== "object" || workflow === null || !("jobs" in workflow)) throw new Error(`expected ${file} to hold a jobs table`);
  const jobs: unknown = workflow.jobs;
  if (typeof jobs !== "object" || jobs === null) throw new Error(`expected ${file} to hold a jobs table`);
  return jobs;
};

async function expectNoRemoteCall(repo: FixtureRepo): Promise<void> {
  for (const name of await held(repo)) expectNoRemoteUses(name, await text(repo, name));
}

test("a code repository without workflows is refused until --write writes the set, with no byte changes to the opt-out release template", async () => {
  const repo = await open({ "package.json": manifest(), ".bun-version": `${FLEET_BUN_VERSION}\n` });
  await repo.commit("start");

  const missing = await workflows(repo);
  expect(missing.exitCode).toBe(1);
  for (const name of ["ci.yml", "pr-title.yml", "main.yml", "release.yml"]) expect(missing.text).toContain(`  .github/workflows/${name}: missing\n`);
  expect(missing.text).toContain("  .github/actions/setup/action.yml: missing\n");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await held(repo)).toEqual(["ci.yml", "main.yml", "pr-title.yml", "release.yml"]);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    on: { pull_request: { types: ["opened", "synchronize", "reopened", "ready_for_review"] }, workflow_dispatch: null },
    concurrency: { "cancel-in-progress": true },
    jobs: { static: { needs: "changes" }, unit: { needs: "changes" }, checks: { needs: ["changes", "static", "unit"] } },
  });
  expect(await parsed(repo, "pr-title.yml")).toMatchObject({ on: { pull_request: { types: ["opened", "synchronize", "reopened", "edited"] } } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ on: { push: { branches: ["main"] } } });
  expect(await text(repo, "release.yml")).toBe(await readFile(RELEASE_WITHOUT_VERSION, "utf8"));
  await expectNoRemoteCall(repo);

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
  await repo.commit("ci: write the workflow set");
  const wiring = await ran($`bun ${WIRING}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(wiring).toEqual({ exitCode: 0, text: "ci-wiring: .github/workflows holds the set checks-workflows writes, so the set runs every gate\n" });
}, 30_000);

test("a legacy all-tier test job splits into gated unit and e2e jobs without installing Playwright in unit", async () => {
  const legacy = "name: ci\non: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/playwright\n        with:\n          browsers: chromium webkit\n      - id: test\n        run: bun run test --pr --parallel=6\n";
  const repo = await open({
    "package.json": manifest(),
    "tests/unit/one.test.ts": "export {};\n",
    "tests/e2e/one.test.ts": "export {};\n",
    ".github/workflows/ci.yml": legacy,
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const jobs = jobsOf(await parsed(repo, "ci.yml"), "ci.yml");
  const jobsRecord: unknown = jobs;
  const unitJob: unknown = isRecord(jobsRecord) ? jobsRecord["unit"] : undefined;
  const unitSteps: readonly unknown[] = isRecord(unitJob) && Array.isArray(unitJob["steps"]) ? unitJob["steps"] : [];
  expect(jobs).toMatchObject({
    unit: { steps: expect.arrayContaining([{ id: "test", run: "bun run test --pr --parallel=6 --tier=unit" }]) },
    e2e: { steps: expect.arrayContaining([{ uses: "./.github/actions/playwright", with: { browsers: "chromium webkit" } }, { id: "test", run: "bun run test --pr --parallel=6 --tier=e2e" }]) },
    checks: { needs: ["changes", "static", "unit", "e2e"] },
  });
  expect(jobs).not.toHaveProperty("test");
  const usesPlaywright = unitSteps.some((step) => isRecord(step) && step["uses"] === "./.github/actions/playwright");
  expect(usesPlaywright).toBe(false);
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("a repository without e2e test files gets no e2e job or Playwright action", async () => {
  const repo = await open({ "package.json": manifest(), "tests/unit/one.test.ts": "export {};\n" });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const jobs = jobsOf(await parsed(repo, "ci.yml"), "ci.yml");
  expect(jobs).not.toHaveProperty("e2e");
  expect(jobs).toMatchObject({ checks: { needs: ["changes", "static", "unit"] } });
  expect(await readdir(join(repo.dir, ".github", "actions"))).not.toContain("playwright");
  await repo.write({ "tests/e2e/one.test.ts": "export {};\n" });
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const withE2e = jobsOf(await parsed(repo, "ci.yml"), "ci.yml");
  expect(withE2e).toMatchObject({ e2e: { needs: "changes" }, checks: { needs: ["changes", "static", "unit", "e2e"] } });
}, 30_000);

test("a project with docs:build loses its docs-only pull request build, or a project without it gets a docs job", async () => {
  const scripts = { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" };
  const repo = await open({ "package.json": manifest({ scripts: { ...scripts, "docs:build": "echo docs" } }) });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      docs: { needs: "changes", if: "needs.changes.outputs.release != 'true'", steps: expect.arrayContaining([{ run: "bun run docs:build" }]) },
      checks: { needs: ["changes", "static", "docs", "unit"] },
    },
  });
  expect((await workflows(repo)).exitCode).toBe(0);
  await Bun.write(join(repo.dir, "package.json"), manifest({ scripts }));
  expect((await workflows(repo)).exitCode).toBe(1);
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(jobsOf(await parsed(repo, "ci.yml"), "ci.yml")).not.toHaveProperty("docs");
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("a generated e2e job kept after the last e2e test is deleted is rejected", async () => {
  const repo = await open({ "package.json": manifest(), "tests/unit/one.test.ts": "export {};\n", "tests/e2e/one.test.ts": "export {};\n" });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(jobsOf(await parsed(repo, "ci.yml"), "ci.yml")).toHaveProperty("e2e");
  await rm(join(repo.dir, "tests", "e2e", "one.test.ts"));
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const jobs = jobsOf(await parsed(repo, "ci.yml"), "ci.yml");
  expect(jobs).not.toHaveProperty("e2e");
  expect(jobs).toMatchObject({ checks: { needs: ["changes", "static", "unit"] } });
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

const SITE_FLAGS = ["--pages", SITE.pages, "--domain", SITE.domain, "--production", SITE.production];

test("a first site write takes the three names as flags, writes them into the workflow env, keeps the weekly advisories cron, and loses the workflow files the set replaces", async () => {
  const repo = await open({
    "package.json": manifest(),
    ".github/workflows/pages.yml": "name: pages\non: push\n",
    ".github/workflows/advisories.yml": 'name: advisories\non:\n  schedule:\n    - cron: "15 5 * * 1"\n',
  });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/pages.yml: no file of the set, so delete it\n");
  expect(refused.text).toContain("  .github/workflows/advisories.yml: differs from the file checks-workflows writes\n");

  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({
    exitCode: 0,
    text: "workflows: wrote the 7 workflow file(s) of the site set and its 3 action file(s), and deleted pages.yml\n",
  });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "main.yml", "pr-title.yml", "preview-close.yml", "production.yml", "release.yml"]);
  expect(await parsed(repo, "advisories.yml")).toMatchObject({
    on: { workflow_dispatch: null, schedule: [{ cron: "15 5 * * 1" }] },
    jobs: { advisories: { permissions: { contents: "read", issues: "write" } } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    env: { SITE_PAGES: SITE.pages },
    jobs: { site: { needs: "changes" }, browser: { needs: "site" }, checks: { needs: ["changes", "static", "site", "unit", "browser"] } },
  });
  expect(await parsed(repo, "preview-close.yml")).toMatchObject({ on: { pull_request: { types: ["closed"] } } });
  expect(await parsed(repo, "production.yml")).toMatchObject({
    on: { workflow_dispatch: null },
    env: { SITE_PAGES: SITE.pages, SITE_DOMAIN: SITE.domain, SITE_PRODUCTION: SITE.production },
  });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });

  await repo.commit("ci: write the site set");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the site set and its 3 action file(s)\n" });
  expect((await $`git status --porcelain`.cwd(repo.dir).text()).trim()).toBe("");
}, 30_000);

test("a package.json site field makes no site, so a repository with one and no site workflow is judged as code", async () => {
  const repo = await open({ "package.json": manifest({ site: SITE }) });
  await repo.commit("start");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
}, 30_000);

test("a site workflow that names only its Pages project is refused with the flags to pass, and --write without them writes nothing", async () => {
  const partial = "name: ci\non: pull_request\nenv:\n  SITE_PAGES: acme\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": partial });
  await repo.commit("start");
  const advice = "the site workflows name no domain and production, so run checks-workflows --write --domain <domain> --production <owner/name>\n";

  expect(await workflows(repo)).toEqual({ exitCode: 1, text: `workflows: ${advice}` });
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 2, text: `workflows: ${advice}` });
  expect(await held(repo)).toEqual(["ci.yml"]);
  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({ exitCode: 0, text: "workflows: wrote the 6 workflow file(s) of the site set and its 3 action file(s)\n" });
}, 30_000);

test("an edited line in a written file is refused with the line it holds and the line checks-workflows writes", async () => {
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
      "  .github/workflows/ci.yml: differs from the file checks-workflows writes",
      '    line 12: holds "  cancel-in-progress: false", checks-workflows writes "  cancel-in-progress: true"',
      "  run checks-workflows --write to write the set",
    ].join("\n"),
  );
}, 30_000);

test("an opted-in release.yml keeps the version in env rather than run and refuses an inline edit", async () => {
  const optIn = "name: release\non:\n  workflow_dispatch:\n    inputs:\n      version:\n        type: string\njobs: {}\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/release.yml": optIn });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const release = await parsed(repo, "release.yml");
  expect(release).toMatchObject({
    on: { workflow_dispatch: { inputs: { version: { type: "string", required: false } } } },
    jobs: {
      "pull-request": {
        steps: expect.arrayContaining([expect.objectContaining({ run: "bunx checks-release-pr ci.yml", env: expect.objectContaining({ CHECKS_RELEASE_VERSION: "${{ inputs.version }}" }) })]),
      },
    },
  });
  expect(release).toHaveProperty("jobs.pull-request.permissions", { contents: "write", "pull-requests": "write", actions: "write" });
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });

  const inline = (await text(repo, "release.yml"))
    .replace("          CHECKS_RELEASE_VERSION: ${{ inputs.version }}\n", "")
    .replace("run: bunx checks-release-pr ci.yml", "run: bunx checks-release-pr --version ${{ inputs.version }} ci.yml");
  await Bun.write(join(repo.dir, ".github", "workflows", "release.yml"), inline);
  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/release.yml: differs from the file checks-workflows writes\n");
}, 30_000);

test("a pr-text.yml scan stays as it is: it is no extra, --write keeps it, and it is never compared", async () => {
  const scan = "name: pr-text\non:\n  pull_request_target:\n    types: [opened]\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/pr-text.yml": scan });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/ci.yml: missing\n");
  expect(refused.text).not.toContain("pr-text");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await text(repo, "pr-text.yml")).toBe(scan);
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("an unknown flag, or a site flag without --write, is refused", async () => {
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": "name: ci\n" });
  await repo.commit("start");

  const flagged = await workflows(repo, ["--force"]);
  expect(flagged.exitCode).toBe(2);
  expect(flagged.text).toContain("usage: workflows.ts [--write [--pages <project>] [--domain <domain>] [--production <owner/name>]]");
  expect((await workflows(repo, SITE_FLAGS)).exitCode).toBe(2);
}, 30_000);

test("a job that calls avi2d/workflows is refused instead of passing as the set, and --write replaces it with the full ci.yml", async () => {
  const caller = "name: ci\non: pull_request\njobs:\n  checks:\n    uses: avi2d/workflows/.github/workflows/ci.yml@v3\n    permissions: { contents: read }\n";
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");
  await workflows(repo, ["--write"]);
  await Bun.write(join(repo.dir, ".github", "workflows", "ci.yml"), caller);

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain(
    [
      "workflows: 1 job(s) call a workflow of another repository:",
      "  .github/workflows/ci.yml job checks: calls avi2d/workflows/.github/workflows/ci.yml@v3, a workflow of another repository, where the set holds every step itself",
      "  run checks-workflows --write to write the set",
    ].join("\n"),
  );

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a pr-text.yml job that calls avi2d/workflows is refused instead of passing uncompared", async () => {
  const caller = "name: pr-text\non: pull_request_target\njobs:\n  text:\n    uses: avi2d/workflows/.github/workflows/pr-text.yml@v3\n    permissions: { contents: read }\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/pr-text.yml": caller });
  await repo.commit("start");
  await workflows(repo, ["--write"]);

  const refused = await workflows(repo);
  expect(refused).toEqual({
    exitCode: 1,
    text: [
      "workflows: .github/workflows holds the code set checks-workflows writes",
      "workflows: 1 job(s) call a workflow of another repository:",
      "  .github/workflows/pr-text.yml job text: calls avi2d/workflows/.github/workflows/pr-text.yml@v3, a workflow of another repository, where the set holds every step itself",
      "  checks-workflows --write never writes .github/workflows/pr-text.yml, so replace its calling jobs with their own steps by hand",
      "",
    ].join("\n"),
  });
}, 30_000);

test("a site-ci.yml shared caller is refused, and --write writes the site set with the caller names in SITE_* env", async () => {
  const caller = "name: site-ci\non: pull_request\njobs:\n  ci:\n    uses: acme/workflows/.github/workflows/site-ci.yml@v3\n    with:\n      pages: acme\n      domain: acme.example\n      production: acme/acme.example\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/site-ci.yml": caller });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("workflows: 1 job(s) call a workflow of another repository:");

  expect(await workflows(repo, ["--write"])).toEqual({
    exitCode: 0,
    text: "workflows: wrote the 6 workflow file(s) of the site set and its 3 action file(s), and deleted site-ci.yml\n",
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({ env: { SITE_PAGES: "acme" } });
  expect(await parsed(repo, "production.yml")).toMatchObject({
    env: { SITE_PAGES: "acme", SITE_DOMAIN: "acme.example", SITE_PRODUCTION: "acme/acme.example" },
  });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });
}, 30_000);

test("a ci.yml that calls test.yml keeps its run, browsers and runs-on, so --write carries the custom test job", async () => {
  const caller = "name: ci\non: pull_request\njobs:\n  e2e:\n    uses: acme/workflows/.github/workflows/test.yml@v3\n    with:\n      run: bun run test:e2e\n      browsers: chromium\n      runs-on: ubuntu-latest\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": caller });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({
    exitCode: 0,
    text: "workflows: wrote the 4 workflow file(s) of the code set and its 3 action file(s)\n",
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: { e2e: { "runs-on": "ubuntu-latest", steps: expect.arrayContaining([{ id: "test", run: "bun run test:e2e" }]) } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: { e2e: { steps: expect.arrayContaining([{ uses: "./.github/actions/playwright", with: { browsers: "chromium" } }]) } },
  });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a shared ci.yml that passes hold, artifact and heavy keeps the site browser on the build", async () => {
  const caller = "name: ci\non: pull_request\njobs:\n  unit:\n    uses: acme/workflows/.github/workflows/test.yml@v3\n    with:\n      hold: false\n      runs-on: ubuntu-latest\n  browser:\n    uses: acme/workflows/.github/workflows/test.yml@v3\n    with:\n      artifact: site-dist\n      heavy: true\n      runs-on: ubuntu-latest\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": caller });
  await repo.commit("start");

  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({
    exitCode: 0,
    text: "workflows: wrote the 6 workflow file(s) of the site set and its 3 action file(s)\n",
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      unit: { "runs-on": "ubuntu-latest", steps: expect.arrayContaining([expect.objectContaining({ id: "test" })]) },
      browser: { "runs-on": "ubuntu-latest", needs: "site", steps: expect.arrayContaining([expect.objectContaining({ id: "test" })]) },
    },
  });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });
}, 30_000);

test("a caller with an input the set cannot carry refuses --write with the input named and writes nothing", async () => {
  const caller = "name: site-ci\non: pull_request\njobs:\n  ci:\n    uses: acme/workflows/.github/workflows/site-ci.yml@v3\n    with:\n      pages: acme\n      domain: acme.example\n      production: acme/acme.example\n      runs-on: ubuntu-latest\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/site-ci.yml": caller });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({
    exitCode: 2,
    text: "workflows: .github/workflows/site-ci.yml job ci passes runs-on to site-ci.yml, an input the written set cannot carry, so remove it by hand\n",
  });
  expect(await held(repo)).toEqual(["site-ci.yml"]);
}, 30_000);

test("a test.yml caller with an artifact the set cannot carry refuses --write and writes nothing", async () => {
  const caller = "name: ci\non: pull_request\njobs:\n  e2e:\n    uses: acme/workflows/.github/workflows/test.yml@v3\n    with:\n      run: bun run test:e2e\n      artifact: dist\n      runs-on: ubuntu-latest\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": caller });
  await repo.commit("start");
  const before = await text(repo, "ci.yml");

  expect(await workflows(repo, ["--write"])).toEqual({
    exitCode: 2,
    text: "workflows: .github/workflows/ci.yml job e2e passes artifact to test.yml, an input the written ci.yml cannot carry, so remove it by hand\n",
  });
  expect(await held(repo)).toEqual(["ci.yml"]);
  expect(await text(repo, "ci.yml")).toBe(before);
}, 30_000);

test("a test job a person adds to the written ci.yml is refused until --write, which keeps it and makes checks need it", async () => {
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");
  await workflows(repo, ["--write"]);
  await repo.write({ "tests/e2e/one.test.ts": "export {};\n" });
  const ci = join(repo.dir, ".github", "workflows", "ci.yml");
  const e2e = "  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/setup\n      - id: test\n        run: bun run test:e2e\n\n";
  await Bun.write(ci, (await readFile(ci, "utf8")).replace("  checks:\n", `${e2e}  checks:\n`));
  expect((await workflows(repo)).exitCode).toBe(1);

  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      e2e: { needs: "changes", "runs-on": "ubuntu-latest", steps: expect.arrayContaining([{ id: "test", run: "bun run test:e2e" }]) },
      checks: { needs: ["changes", "static", "unit", "e2e"] },
    },
  });
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

const HAND_ROLLED = join(CHECKOUT, "tests", "fixtures", "workflows", "hand-rolled");

const handRolled = async (name: string): Promise<string> => readFile(join(HAND_ROLLED, name), "utf8");

const handRolledFiles = async (): Promise<Readonly<Record<string, string>>> =>
  Object.fromEntries(await Promise.all(["ci.yml", "docs.yml", "flake.yml", "advisories.yml"].map(async (name) => [`.github/workflows/${name}`, await handRolled(name)] as const)));

test("--write keeps a hand-rolled Pages deploy, secrets pack, flake run and weekly scan as written steps, instead of deleting docs.yml or dropping the cron", async () => {
  const repo = await open({ "package.json": manifest(), ...(await handRolledFiles()) });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "docs.yml", "flake.yml", "main.yml", "pr-title.yml", "release.yml"]);
  expect(await parsed(repo, "docs.yml")).toMatchObject({
    jobs: { build: { steps: expect.arrayContaining([expect.objectContaining({ run: "bun run docs:build" }), expect.objectContaining({ with: expect.objectContaining({ path: "docs/.vitepress/dist" }) })]) } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: { static: { steps: expect.arrayContaining([expect.objectContaining({ run: "bunx checks-ci secrets-pack" })]) } },
  });
  expect(await parsed(repo, "flake.yml")).toMatchObject({
    jobs: { flake: { steps: expect.arrayContaining([expect.objectContaining({ with: expect.objectContaining({ "node-version-file": ".node-version" }) })]) } },
  });
  expect(await parsed(repo, "advisories.yml")).toMatchObject({ on: { schedule: [{ cron: "21 5 * * 1" }] } });
  expect(await parsed(repo, "main.yml")).toMatchObject({
    jobs: { suite: { steps: expect.arrayContaining([expect.objectContaining({ run: "bun run test --full" })]) } },
  });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a public repository with a private package keeps hosted runners on fork-reachable jobs and the override on trusted workflows", async () => {
  const repo = await open({
    "package.json": manifest({ private: true }),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    "event.json": JSON.stringify({ repository: { private: false } }),
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  for (const name of ["ci.yml", "pr-title.yml"]) {
    for (const [jobName, job] of Object.entries(jobsOf(await parsed(repo, name), name))) {
      if (typeof job !== "object" || job === null || !("runs-on" in job)) throw new Error(`expected ${name} job ${jobName} to name runs-on`);
      expect(job["runs-on"]).toBe("ubuntu-latest");
    }
  }
  for (const name of ["main.yml", "release.yml"]) {
    for (const [jobName, job] of Object.entries(jobsOf(await parsed(repo, name), name))) {
      if (typeof job !== "object" || job === null || !("runs-on" in job)) throw new Error(`expected ${name} job ${jobName} to name runs-on`);
      expect(job["runs-on"]).toBe("${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}");
    }
  }
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      changes: { "runs-on": "ubuntu-latest" },
      static: { "runs-on": "ubuntu-latest" },
      unit: { "runs-on": "ubuntu-latest" },
      checks: { "runs-on": "ubuntu-latest" },
    },
  });
  expect(await parsed(repo, "main.yml")).toMatchObject({
    jobs: { release: { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" } },
  });
  expect(await parsed(repo, "release.yml")).toMatchObject({
    jobs: { "pull-request": { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" } },
  });
  const wiring = await ran($`bun ${WIRING}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_EVENT_PATH: join(repo.dir, "event.json") }));
  expect(wiring.exitCode).toBe(0);
}, 30_000);

test("a private repository with a public package must not lose the runner override", async () => {
  const repo = await open({
    "package.json": manifest(),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    "checks.config.ts": 'export default { repositoryVisibility: "private" };\n',
    "event.json": JSON.stringify({ repository: { private: true } }),
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: { unit: { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" } },
  });
  const wiring = await ran($`bun ${WIRING}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_EVENT_PATH: join(repo.dir, "event.json") }));
  expect(wiring.exitCode).toBe(0);
}, 30_000);

test("a private package's release runs the full suite instead of skipping it", async () => {
  const repo = await open({ "package.json": manifest({ private: true }) });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "main.yml")).toMatchObject({
    jobs: { suite: { steps: expect.arrayContaining([expect.objectContaining({ run: "bun run test --full" })]) } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      unit: {
        steps: expect.arrayContaining([expect.objectContaining({ id: "test", env: expect.objectContaining({ CHECK_RELEASE: "${{ needs.changes.outputs.check-release }}" }), run: "bunx checks-ci test" })]),
      },
    },
  });
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

const gatesOver = async (repo: FixtureRepo): Promise<readonly (readonly [string, number, string])[]> =>
  Promise.all(
    [["plain-steps", PLAIN_STEPS], ["workflows", SCRIPT], ["ci-wiring", WIRING]].map(async ([gate = "", script = ""]) => {
      const { exitCode, text: output } = await ran($`bun ${script}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
      return [gate, exitCode, exitCode === 0 ? "" : output] as const;
    }),
  );

test("every set --write writes passes checks-plain-steps, checks-workflows and checks-ci-wiring, so a release test step chosen by an expression fails here", async () => {
  const everyOption = await handRolledFiles();
  const bunVersion = { ".bun-version": FLEET_BUN_VERSION + "\n" };
  const variants: readonly (readonly [string, Readonly<Record<string, string>>, readonly string[]])[] = [
    ["code", { "package.json": manifest(), ...bunVersion }, []],
    ["site", { "package.json": manifest(), ...bunVersion }, SITE_FLAGS],
    ["release checks", { "package.json": manifest({ private: true }), ...bunVersion }, []],
    ["release checks with a secrets pack, Pages, flake and advisories", { "package.json": manifest({ private: true }), ...bunVersion, ...everyOption }, []],
  ];
  for (const [variant, files, flags] of variants) {
    const repo = await open(files);
    await repo.commit("start");
    expect([variant, (await workflows(repo, ["--write", ...flags])).exitCode]).toEqual([variant, 0]);
    await repo.commit("ci: write the workflow set");
    expect([variant, await gatesOver(repo)]).toEqual([variant, [["plain-steps", 0, ""], ["workflows", 0, ""], ["ci-wiring", 0, ""]]]);
  }
}, 60_000);

test("releaseAssets writes an assets job that passes checks-plain-steps, checks-workflows and checks-ci-wiring, and is refused without a release:assets script instead of writing a job that cannot build", async () => {
  const withScript = manifest({ scripts: { test: "bun test", "release:assets": "bun scripts/assets.ts" } });
  const repo = await open({ "package.json": withScript, ".bun-version": FLEET_BUN_VERSION + "\n", "checks.config.ts": "export default { releaseAssets: true };\n" });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(Object.keys(jobsOf(await parsed(repo, "main.yml"), "main.yml"))).toEqual(["suite", "release", "assets"]);
  await repo.commit("ci: write the workflow set");
  expect(await gatesOver(repo)).toEqual([["plain-steps", 0, ""], ["workflows", 0, ""], ["ci-wiring", 0, ""]]);

  const bare = await open({ "package.json": manifest(), "checks.config.ts": "export default { releaseAssets: true };\n" });
  await bare.commit("start");
  expect(await workflows(bare, ["--write"])).toEqual({
    exitCode: 2,
    text: "workflows: checks.config.ts sets releaseAssets, but package.json defines no release:assets script to build the assets, so add the script or remove the setting\n",
  });
}, 60_000);

test("platformPackages writes a binaries job that passes checks-plain-steps, checks-workflows and checks-ci-wiring, and is refused without a release:assets script instead of writing a job that cannot build", async () => {
  const config = 'export default { platformPackages: { binary: "acme", platforms: ["darwin-arm64", "linux-x64"] } };\n';
  const withScript = manifest({ scripts: { test: "bun test", "release:assets": "bun scripts/assets.ts" } });
  const repo = await open({ "package.json": withScript, ".bun-version": FLEET_BUN_VERSION + "\n", "checks.config.ts": config });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const jobs = jobsOf(await parsed(repo, "main.yml"), "main.yml");
  expect(Object.keys(jobs)).toEqual(["suite", "binaries", "release"]);
  expect(jobs).toMatchObject({
    release: { steps: expect.arrayContaining([expect.objectContaining({ run: "bunx checks-release-tag", env: expect.objectContaining({ CHECKS_PLATFORM_BINARIES: "${{ runner.temp }}/platform-binaries" }) })]) },
  });
  await repo.commit("ci: write the workflow set");
  expect(await gatesOver(repo)).toEqual([["plain-steps", 0, ""], ["workflows", 0, ""], ["ci-wiring", 0, ""]]);

  const bare = await open({ "package.json": manifest(), "checks.config.ts": config });
  await bare.commit("start");
  expect(await workflows(bare, ["--write"])).toEqual({
    exitCode: 2,
    text: "workflows: checks.config.ts sets platformPackages, but package.json defines no release:assets script to build the binaries, so add the script or remove the setting\n",
  });
}, 60_000);

test("platformPackages under a private root with one public workspace writes the binaries job and publishes the workspace, instead of refusing the release or dropping the binaries", async () => {
  const repo = await open({
    "package.json": manifest({ private: true, workspaces: ["packages/*"], scripts: { "release:assets": "bun scripts/assets.ts" } }),
    "packages/run/package.json": JSON.stringify({ name: "@acme/cli", version: "1.0.0" }),
    "checks.config.ts": 'export default { platformPackages: { binary: "acme", platforms: ["linux-x64"] } };\n',
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(jobsOf(await parsed(repo, "main.yml"), "main.yml")).toMatchObject({
    binaries: expect.anything(),
    release: {
      steps: expect.arrayContaining([
        expect.objectContaining({ run: "bunx checks-release-tag", env: expect.objectContaining({ CHECKS_PUBLISH_WORKSPACES: "true", CHECKS_PLATFORM_BINARIES: "${{ runner.temp }}/platform-binaries" }) }),
      ]),
    },
  });
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("platformPackages under a private root with two public workspaces is refused in both modes, instead of naming the platform packages after one workspace and publishing another", async () => {
  const repo = await open({
    "package.json": manifest({ private: true, workspaces: ["packages/*"], scripts: { "release:assets": "bun scripts/assets.ts" } }),
    "packages/run/package.json": JSON.stringify({ name: "@acme/cli", version: "1.0.0" }),
    "packages/web/package.json": JSON.stringify({ name: "@acme/web", version: "1.0.0" }),
    "checks.config.ts": 'export default { platformPackages: { binary: "acme", platforms: ["linux-x64"] } };\n',
  });
  await repo.commit("start");
  const refused = { exitCode: 2, text: "workflows: checks.config.ts sets platformPackages, but the private root has more than one public workspace, so publish only one workspace\n" };
  expect(await workflows(repo, ["--write"])).toEqual(refused);
  expect(await workflows(repo)).toEqual(refused);
}, 30_000);

test("a private root with a public workspace does not omit workspace publishing", async () => {
  const repo = await open({
    "package.json": manifest({ private: true, workspaces: ["packages/*"] }),
    "packages/public/package.json": JSON.stringify({ name: "@acme/public", version: "1.0.0" }),
    "packages/private/package.json": JSON.stringify({ name: "@acme/private", version: "1.0.0", private: true }),
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await text(repo, "main.yml")).toContain('          CHECKS_PUBLISH_WORKSPACES: "true"\n        run: bunx checks-release-tag\n');
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("a pinned Claude Code install is not dropped from the test and flake jobs", async () => {
  const install = "npm install -g @anthropic-ai/claude-code@2.1.280";
  const workflow = `name: ci\non: workflow_dispatch\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${install}\n`;
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": workflow, ".github/workflows/flake.yml": workflow });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  for (const name of ["ci.yml", "flake.yml"]) expect(await text(repo, name)).toContain("      - run: npm install --global @anthropic-ai/claude-code@2.1.280\n");
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);
