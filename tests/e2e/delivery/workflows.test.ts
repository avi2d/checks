import { $ } from "bun";
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";
import { expectNoRemoteUses } from "../lib/local-uses.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const SITE = { pages: "acme", domain: "acme.example", production: "acme/acme.example" };
const FLEET_BUN_VERSION = (await readFile(join(CHECKOUT, ".bun-version"), "utf8")).trim();
const open = fixtureRepos("checks-workflows-");

const manifest = (extra: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" }, ...extra });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const held = async (repo: FixtureRepo): Promise<readonly string[]> => (await readdir(join(repo.dir, ".github", "workflows"))).sort();

const text = async (repo: FixtureRepo, name: string): Promise<string> => readFile(join(repo.dir, ".github", "workflows", name), "utf8");

const parsed = async (repo: FixtureRepo, name: string): Promise<unknown> => Bun.YAML.parse(await text(repo, name));

async function expectNoRemoteCall(repo: FixtureRepo): Promise<void> {
  for (const name of await held(repo)) expectNoRemoteUses(name, await text(repo, name));
}

test("a code repository without workflow files is refused until --write writes ci, pr-title, main, release and the setup action, which ci-wiring then accepts", async () => {
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
    jobs: { static: { needs: "changes" }, test: { needs: "changes" }, checks: { needs: ["changes", "static", "test"] } },
  });
  expect(await parsed(repo, "pr-title.yml")).toMatchObject({ on: { pull_request: { types: ["opened", "synchronize", "reopened", "edited"] } } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ on: { push: { branches: ["main"] } } });
  expect(await parsed(repo, "release.yml")).toMatchObject({ on: { workflow_dispatch: null } });
  await expectNoRemoteCall(repo);

  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
  await repo.commit("ci: write the workflow set");
  const wiring = await ran($`bun ${WIRING}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(wiring).toEqual({ exitCode: 0, text: "ci-wiring: .github/workflows holds the set checks-workflows writes, so the set runs every gate\n" });
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
      '    line 10: holds "  cancel-in-progress: false", checks-workflows writes "  cancel-in-progress: true"',
      "  run checks-workflows --write to write the set",
    ].join("\n"),
  );
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
    ].join("\n"),
  );

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set and its 2 action file(s)\n" });
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a test job a person adds to the written ci.yml is refused until --write, which keeps it and makes checks need it", async () => {
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");
  await workflows(repo, ["--write"]);
  const ci = join(repo.dir, ".github", "workflows", "ci.yml");
  const e2e = "  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/setup\n      - id: test\n        run: bun run test:e2e\n\n";
  await Bun.write(ci, (await readFile(ci, "utf8")).replace("  checks:\n", `${e2e}  checks:\n`));
  expect((await workflows(repo)).exitCode).toBe(1);

  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      e2e: { needs: "changes", "runs-on": "ubuntu-latest", steps: expect.arrayContaining([{ id: "test", run: "bun run test:e2e" }]) },
      checks: { needs: ["changes", "static", "test", "e2e"] },
    },
  });
  expect(await text(repo, "ci.yml")).toContain("'static test e2e' || needs.changes.outputs.docs-only == 'true' && 'test e2e' || ''");
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

const HAND_ROLLED = join(CHECKOUT, "tests", "fixtures", "workflows", "hand-rolled");

const handRolled = async (name: string): Promise<string> => readFile(join(HAND_ROLLED, name), "utf8");

test("--write keeps a hand-rolled Pages deploy, secrets pack, flake run and weekly scan as written steps, instead of deleting docs.yml or dropping the cron", async () => {
  const files = Object.fromEntries(
    await Promise.all(["ci.yml", "docs.yml", "flake.yml", "advisories.yml"].map(async (name) => [`.github/workflows/${name}`, await handRolled(name)] as const)),
  );
  const repo = await open({ "package.json": manifest(), ...files });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "docs.yml", "flake.yml", "main.yml", "pr-title.yml", "release.yml"]);
  const docs = await text(repo, "docs.yml");
  expect(docs).toContain("      - run: bun run docs:build\n");
  expect(docs).toContain("          path: docs/.vitepress/dist\n");
  expect(await text(repo, "ci.yml")).toContain("        run: bunx checks-ci secrets-pack\n");
  expect(await text(repo, "flake.yml")).toContain("          node-version-file: .node-version\n");
  expect(await parsed(repo, "advisories.yml")).toMatchObject({ on: { schedule: [{ cron: "21 5 * * 1" }] } });
  expect(await text(repo, "main.yml")).toContain("        run: bun run test --full\n");
  await expectNoRemoteCall(repo);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a private package's release runs the full suite instead of skipping it", async () => {
  const repo = await open({ "package.json": manifest({ private: true }) });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await text(repo, "main.yml")).toContain("        run: bun run test --full\n");
  expect(await text(repo, "ci.yml")).toContain("needs.changes.outputs.check-release == 'true' && 'bun run test' || 'bunx checks-test --pr'");
  expect((await workflows(repo)).exitCode).toBe(0);
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
