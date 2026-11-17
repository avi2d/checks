import { afterEach, beforeEach, expect, test } from "bun:test";
import { type StubApi, apiEnv, recordedCalls, runCi, startStubApi, stubBin, useScratch } from "../../lib/ci-command.ts";

const MAIN = "pages-deploy";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const scratch = useScratch("pages-deploy");
let stub: StubApi;

beforeEach(() => {
  stubBin(scratch.at("bin"), "bunx", "exit ${BUNX_EXIT:-0}");
  stub = startStubApi((method, path) =>
    method === "GET" && path === "/cf/accounts/acct/pages/projects/example-site" ? { status: 200, body: { success: true, result: { subdomain: "example-site.pages.dev" } } } : undefined,
  );
});

afterEach(async () => {
  await stub.stop();
});

function deploy(overrides: Readonly<Record<string, string>> = {}) {
  return runCi(MAIN, [], {
    ...apiEnv(stub, scratch.at("output")),
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    WRANGLER_VERSION: "4.156.1",
    DIRECTORY: "dist",
    PROJECT: "example-site",
    BRANCH: "main",
    COMMIT_HASH: SHA,
    COMMIT_MESSAGE: "Stage main",
    COMMIT_DIRTY: "false",
    ADDRESS: "https://example-site.pages.dev/",
    ...overrides,
  });
}

const calls = () => recordedCalls(scratch.at("calls"));

test("a deploy whose wrangler call drops the project, branch or commit fails", async () => {
  const ran = await deploy();
  expect(ran.exitCode).toBe(0);
  expect(calls()).toEqual([
    ["wrangler@4.156.1", "pages", "deploy", "dist", "--project-name", "example-site", "--branch", "main", "--commit-hash", SHA, "--commit-message", "Stage main 0123456"],
  ]);
});

test("a build pointing at another host than the project serves that deploys passes", async () => {
  const ran = await deploy({ ADDRESS: "https://example.com/" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::Cloudflare serves example-site at https://example-site.pages.dev/, not at the https://example.com/ the build points to");
  expect(calls()).toEqual([]);
});

test("a missing project that creates a Cloudflare project before failing fails", async () => {
  const ran = await deploy({ PROJECT: "missing", ADDRESS: "https://missing.pages.dev/" });
  expect(ran.exitCode).toBe(1);
  expect(stub.requests.map(({ method }) => method)).toEqual(["GET"]);
  expect(calls()).toEqual([]);
});

test("an empty address that still asks Cloudflare for the host fails", async () => {
  const ran = await deploy({ ADDRESS: "" });
  expect(ran.exitCode).toBe(0);
  expect(stub.requests).toEqual([]);
});

test("a wrangler failure that passes fails", async () => {
  expect((await deploy({ BUNX_EXIT: "3" })).exitCode).toBe(1);
});

test("a commit-dirty other than true or false taken as either passes", async () => {
  const ran = await deploy({ COMMIT_DIRTY: "yes" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-deploy needs the commit-dirty input to be true or false, not 'yes'");
});

test("a missing account ID that deploys anyway passes", async () => {
  const ran = await deploy({ CLOUDFLARE_ACCOUNT_ID: "" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-deploy needs the api-token and account-id inputs, and account-id is empty");
  expect(calls()).toEqual([]);
});
