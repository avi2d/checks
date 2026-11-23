import { BunServices } from "@effect/platform-bun";
import { $ } from "bun";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { identicalTestBuild } from "../../../src/quality/browser/build-proof.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo } from "../lib/fixture-repo.ts";
import type { RunScope } from "../../../src/core/pull-request-scope.ts";

type PullRequest = Extract<RunScope, { readonly kind: "pull-request" }>;

const open = fixtureRepos("checks-browser-proof-");

const script = "import { mkdir } from \"node:fs/promises\";\nawait mkdir(\"dist/other\", { recursive: true });\nawait Bun.write(\"dist/index.html\", \"<main>home</main>\");\nawait Bun.write(\"dist/other/index.html\", \"<main>other</main>\");\n";

async function setup(files: Record<string, string>): Promise<FixtureRepo> {
  const repo = await open({
    ".gitignore": "dist/\n",
    "checks.config.ts": "export default { browserBuild: [\"bun\", \"build-site.ts\"] };\n",
    "build-site.ts": script,
    ...files,
  });
  await repo.commit("base");
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(repo.dir).quiet();
  return repo;
}

async function scopeOf(repo: FixtureRepo, changed: readonly string[], head: string): Promise<PullRequest> {
  const base = await $`git rev-parse refs/remotes/origin/main`.cwd(repo.dir).quiet().then((r) => r.stdout.toString().trim());
  return { kind: "pull-request", changed, ends: { base, head } };
}

function proof(repo: FixtureRepo, scope: PullRequest, hooks: string | undefined) {
  return Effect.runPromise(identicalTestBuild(repo.dir, "dist", scope, hooks).pipe(Effect.provide(BunServices.layer)));
}

test("a test-only change with matching builds skips instead of running the browser", async () => {
  const repo = await setup({ "tests/home.test.ts": "before\n" });
  await repo.write({ "tests/home.test.ts": "after\n" });
  const head = await repo.commit("test");
  await $`bun build-site.ts`.cwd(repo.dir).quiet();
  const scope = await scopeOf(repo, ["tests/home.test.ts"], head);
  expect(await proof(repo, scope, undefined)).toBe(true);
}, 60_000);

test("a helper-only pull request does not bypass the matching-build skip", async () => {
  const repo = await setup({
    "tests/unit/helper.ts": "export {};\n",
    "checks.config.ts": `export default {
      browserBuild: ["bun", "build-site.ts"],
      browser: {
        site: "dist",
        routes: [{ path: "/", locale: "en" }],
        viewports: [{ preset: "full" }],
        states: [{ name: "default" }],
        targets: [{ name: "main", selector: "main" }],
        checks: ["html"],
      },
    };\n`,
  });
  await repo.write({ "tests/unit/helper.ts": "export {};\n\n" });
  const head = await repo.commit("test: change the helper");
  await $`bun build-site.ts`.cwd(repo.dir).quiet();
  const event = join(repo.dir, "event.json");
  await Bun.write(event, JSON.stringify({ pull_request: { number: 1, base: { ref: "main" }, head: { sha: head } } }));
  const result = await ran($`bun ${join(CHECKOUT, "src/quality/browser/browser.ts")} --pr`.cwd(repo.dir).env({
    ...withoutPullRequestEvent(), CI: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event,
  }));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("the test-only change builds the same site, so no page was checked");
}, 60_000);

test("a hooks change builds the same site but still runs instead of skipping", async () => {
  const repo = await setup({ "tests/browser/hooks.ts": "export const checks = [];\n" });
  await repo.write({ "tests/browser/hooks.ts": "export const checks = [];\n// touch\n" });
  const head = await repo.commit("hooks");
  await $`bun build-site.ts`.cwd(repo.dir).quiet();
  const scope = await scopeOf(repo, ["tests/browser/hooks.ts"], head);
  expect(await proof(repo, scope, "tests/browser/hooks.ts")).toBe(false);
}, 60_000);
