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
    on: { pull_request: { types: ["opened", "synchronize", "reopened", "ready_for_review"] }, workflow_dispatch: null },
    concurrency: { "cancel-in-progress": true },
    jobs: {
      static: { uses: "avi2d/workflows/.github/workflows/static.yml@v3" },
      test: { uses: "avi2d/workflows/.github/workflows/test.yml@v3" },
      checks: { needs: ["changes", "static", "test"], uses: "avi2d/workflows/.github/workflows/gate.yml@v3" },
    },
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

const SITE_FLAGS = ["--pages", SITE.pages, "--domain", SITE.domain, "--production", SITE.production];

test("a first site write takes the three names as flags, gets the six site callers, keeps advisories in its caller form with its weekly cron, and loses the workflow files the set replaces", async () => {
  const repo = await open({
    "package.json": manifest(),
    ".github/workflows/pages.yml": "name: pages\non: push\n",
    ".github/workflows/advisories.yml": "name: advisories\non:\n  schedule:\n    - cron: \"15 5 * * 1\"\n",
  });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/pages.yml: no workflow of the set, so delete it\n");
  expect(refused.text).toContain("  .github/workflows/advisories.yml: differs from the caller checks-workflows writes\n");

  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the site set, and deleted pages.yml\n" });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "main.yml", "pr-title.yml", "preview-close.yml", "production.yml", "release.yml"]);
  expect(await parsed(repo, "advisories.yml")).toEqual({
    name: "advisories",
    on: { workflow_dispatch: null, schedule: [{ cron: "15 5 * * 1" }] },
    jobs: { advisories: { uses: "avi2d/workflows/.github/workflows/advisories.yml@v3", permissions: { contents: "read", issues: "write" } } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      site: {
        uses: "avi2d/workflows/.github/workflows/site-preview.yml@v3",
        with: { pages: SITE.pages },
        secrets: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}", CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" },
      },
      browser: { needs: "site", uses: "avi2d/workflows/.github/workflows/test.yml@v3" },
      checks: { needs: ["changes", "static", "site", "unit", "browser"], uses: "avi2d/workflows/.github/workflows/gate.yml@v3" },
    },
  });
  expect(await parsed(repo, "preview-close.yml")).toMatchObject({ on: { pull_request: { types: ["closed"] } } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ jobs: { release: { uses: "avi2d/workflows/.github/workflows/site-main.yml@v3" } } });
  expect(await parsed(repo, "production.yml")).toMatchObject({
    on: { workflow_dispatch: null },
    jobs: { production: { uses: "avi2d/workflows/.github/workflows/site-production.yml@v3", with: SITE } },
  });
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the site set checks-workflows writes\n" });

  await repo.commit("ci: write the site set");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the site set\n" });
  expect((await $`git status --porcelain`.cwd(repo.dir).text()).trim()).toBe("");
}, 30_000);

test("a package.json site field makes no site, so a repository with one and no site caller is judged as code", async () => {
  const repo = await open({ "package.json": manifest({ site: SITE }) });
  await repo.commit("start");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set\n" });
}, 30_000);

test("site callers that pass no names are refused with the flags to pass, and --write without them writes nothing", async () => {
  const unnamed = "name: ci\non: pull_request\njobs:\n  checks:\n    uses: avi2d/workflows/.github/workflows/site-ci.yml@v3\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": unnamed });
  await repo.commit("start");
  const advice = "the site callers pass no pages, domain and production, so run checks-workflows --write --pages <project> --domain <domain> --production <owner/name>\n";

  expect(await workflows(repo)).toEqual({ exitCode: 1, text: `workflows: ${advice}` });
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 2, text: `workflows: ${advice}` });
  expect(await held(repo)).toEqual(["ci.yml"]);
  expect(await workflows(repo, ["--write", ...SITE_FLAGS])).toEqual({ exitCode: 0, text: "workflows: wrote the 6 workflow file(s) of the site set\n" });
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

test("a pr-text.yml scan stays as it is: it is no extra, --write keeps it, and it is never compared", async () => {
  const scan = "name: pr-text\non:\n  pull_request_target:\n    types: [opened]\n";
  const repo = await open({ "package.json": manifest(), ".github/workflows/pr-text.yml": scan });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/ci.yml: missing\n");
  expect(refused.text).not.toContain("pr-text");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set\n" });
  expect(await readFile(join(repo.dir, ".github", "workflows", "pr-text.yml"), "utf8")).toBe(scan);
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("the shared workflow repository keeps its own files and an unknown flag is refused", async () => {
  const repo = await open({ "package.json": manifest(), ".github/workflows/ci.yml": "name: ci\n" });
  await repo.commit("start");

  const shared = await ran($`bun ${SCRIPT}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "avi2d/workflows" }));
  expect(shared).toEqual({ exitCode: 0, text: "workflows: this repository holds the shared workflows, so it keeps its own workflow files\n" });

  const flagged = await workflows(repo, ["--force"]);
  expect(flagged.exitCode).toBe(2);
  expect(flagged.text).toContain("usage: workflows.ts [--write [--pages <project>] [--domain <domain>] [--production <owner/name>]]");
  expect((await workflows(repo, SITE_FLAGS)).exitCode).toBe(2);
}, 30_000);

test("a code repository on the single-job ci.yml passes with the command that writes the composed one, and --write keeps the test jobs it then holds", async () => {
  const single = [
    "name: ci",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize, reopened, ready_for_review]",
    "  workflow_dispatch:",
    "",
    "concurrency:",
    "  group: ci-${{ github.event.pull_request.number || github.run_id }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  checks:",
    "    uses: avi2d/workflows/.github/workflows/ci.yml@v3",
    "    permissions: { contents: read, actions: write, statuses: write, pull-requests: read }",
    "",
  ].join("\n");
  const repo = await open({ "package.json": manifest() });
  await repo.commit("start");
  await workflows(repo, ["--write"]);
  await Bun.write(join(repo.dir, ".github", "workflows", "ci.yml"), single);

  expect(await workflows(repo)).toEqual({
    exitCode: 0,
    text: [
      "workflows: .github/workflows holds the code set checks-workflows writes",
      "workflows: .github/workflows/ci.yml is the single-job caller, so run checks-workflows --write to write the composed ci.yml",
      "",
    ].join("\n"),
  });

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 4 workflow file(s) of the code set\n" });
  const ci = join(repo.dir, ".github", "workflows", "ci.yml");
  const e2e = "  e2e:\n    uses: avi2d/workflows/.github/workflows/test.yml@v3\n    with:\n      run: bun run test:e2e\n";
  await Bun.write(ci, (await readFile(ci, "utf8")).replace("  checks:\n", `${e2e}  checks:\n`));
  expect((await workflows(repo)).exitCode).toBe(1);

  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await parsed(repo, "ci.yml")).toMatchObject({
    jobs: {
      e2e: { needs: "changes", uses: "avi2d/workflows/.github/workflows/test.yml@v3", with: { run: "bun run test:e2e" } },
      checks: { needs: ["changes", "static", "test", "e2e"], with: { skips: "${{ needs.changes.outputs.release == 'true' && 'static test e2e' || needs.changes.outputs.docs-only == 'true' && 'test e2e' || '' }}" } },
    },
  });
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

const HAND_ROLLED = join(CHECKOUT, "tests", "fixtures", "workflows", "hand-rolled");

const handRolled = async (name: string): Promise<string> => readFile(join(HAND_ROLLED, name), "utf8");

test("--write turns a hand-rolled Pages deploy, secrets pack, flake run and weekly scan into callers that keep them, instead of deleting docs.yml or dropping the cron", async () => {
  const files = Object.fromEntries(
    await Promise.all(["ci.yml", "docs.yml", "flake.yml", "advisories.yml"].map(async (name) => [`.github/workflows/${name}`, await handRolled(name)] as const)),
  );
  const repo = await open({ "package.json": manifest(), ...files });
  await repo.commit("start");

  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 7 workflow file(s) of the code set\n" });
  expect(await held(repo)).toEqual(["advisories.yml", "ci.yml", "docs.yml", "flake.yml", "main.yml", "pr-title.yml", "release.yml"]);
  expect(await parsed(repo, "docs.yml")).toMatchObject({
    on: { push: { branches: ["main"] } },
    jobs: { pages: { uses: "avi2d/workflows/.github/workflows/github-pages.yml@v3", with: { build: "bun run docs:build", path: "docs/.vitepress/dist" } } },
  });
  expect(await parsed(repo, "ci.yml")).toMatchObject({ jobs: { static: { with: { "secrets-pack": true }, secrets: { CHECKS_SECRETS_PACK: "${{ secrets.CHECKS_SECRETS_PACK }}" } } } });
  expect(await parsed(repo, "flake.yml")).toMatchObject({ jobs: { flake: { uses: "avi2d/workflows/.github/workflows/flake.yml@v3", with: { "node-version-file": ".node-version" } } } });
  expect(await parsed(repo, "advisories.yml")).toMatchObject({ on: { schedule: [{ cron: "21 5 * * 1" }] } });
  expect(await parsed(repo, "main.yml")).toMatchObject({ jobs: { release: { with: { "full-test": true } } } });
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a private package's main.yml runs no full suite before the release, since checks-release-tag publishes nothing for it", async () => {
  const repo = await open({ "package.json": manifest({ private: true }) });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  const main = await parsed(repo, "main.yml");
  expect(main).toMatchObject({ jobs: { release: { uses: "avi2d/workflows/.github/workflows/release-main.yml@v3" } } });
  expect(JSON.stringify(main)).not.toContain("full-test");
}, 30_000);
