import { afterEach, beforeEach, expect, test } from "bun:test";
import { type StubApi, apiEnv, runCi, startStubApi, useScratch } from "../../lib/ci-command.ts";

const MAIN = "pages-staged-commit";
const SHA = "abc1234def5678abc1234def5678abc1234def56";
const SERVED = {
  id: "d1",
  environment: "production",
  latest_stage: { name: "deploy", status: "success" },
  deployment_trigger: { metadata: { branch: "main", commit_hash: "abc1234" } },
};

type World = { comparison: string; greenRuns: number; served: typeof SERVED };

const scratch = useScratch("production-staged-commit");
let stub: StubApi;
let world: World;

beforeEach(() => {
  world = { comparison: "behind", greenRuns: 1, served: SERVED };
  stub = startStubApi((method, path) => {
    if (method !== "GET") return undefined;
    if (path === "/cf/accounts/acct/pages/projects/site") {
      return { status: 200, body: { success: true, result: { subdomain: "site.pages.dev", canonical_deployment: world.served } } };
    }
    if (path === "/gh/repos/owner/site/commits/abc1234") return { status: 200, body: { sha: SHA } };
    if (path === `/gh/repos/owner/site/compare/main...${SHA}`) return { status: 200, body: { status: world.comparison } };
    if (path === `/gh/repos/owner/site/actions/workflows/pages.yml/runs?head_sha=${SHA}&status=success`) {
      return { status: 200, body: { total_count: world.greenRuns, workflow_runs: [] } };
    }
    return undefined;
  });
});

afterEach(async () => {
  await stub.stop();
});

function stage(overrides: Readonly<Record<string, string>> = {}) {
  return runCi(MAIN, [], {
    ...apiEnv(stub, scratch.at("output")),
    DEPLOY_KEY: "deploy-key-value",
    PROJECT: "site",
    BRANCH: "main",
    WORKFLOW: "pages.yml",
    ...overrides,
  });
}

const output = () => scratch.read("output");

test("a served commit on main that a green pages run deployed, left unwritten or read with the wrong token, fails", async () => {
  const ran = await stage();
  expect(ran.exitCode).toBe(0);
  expect(output()).toBe(`sha=${SHA}\n`);
  expect(stub.requests.map(({ path, authorization }) => [path.split("/")[1], authorization])).toEqual([
    ["cf", "Bearer cf-token-value"],
    ["gh", "Bearer gh-token-value"],
    ["gh", "Bearer gh-token-value"],
    ["gh", "Bearer gh-token-value"],
  ]);
  expect(ran.stdout + ran.stderr).not.toContain("cf-token-value");
});

test("a served commit main has not reached that passes fails", async () => {
  world.comparison = "ahead";
  const ran = await stage();
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::the Pages project site serves ${SHA}, which is not on main`);
  expect(output()).toBe("");
});

test("a served commit no green pages run deployed that passes fails", async () => {
  world.greenRuns = 0;
  const ran = await stage();
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::no green pages.yml run has deployed ${SHA}`);
});

test("a production that serves a deployment still building read as staged passes", async () => {
  world.served = { ...SERVED, latest_stage: { name: "build", status: "active" } };
  const ran = await stage();
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::the Pages project site serves no deployment with a commit");
});

test("a missing deploy key that is let through to the tests passes", async () => {
  const ran = await stage({ DEPLOY_KEY: "" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-staged-commit needs the deploy-key input, and it is empty");
  expect(stub.requests).toEqual([]);
});

test("a missing Cloudflare token sent on to the API passes", async () => {
  const ran = await stage({ CLOUDFLARE_API_TOKEN: "" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-staged-commit needs the api-token and account-id inputs, and api-token is empty");
  expect(stub.requests).toEqual([]);
});
